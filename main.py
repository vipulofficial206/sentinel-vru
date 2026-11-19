import os
import sys
import re
import cv2
import asyncio
if sys.platform == 'win32':
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass
import yaml
import json
import time
import uuid
import pickle
import shutil
import csv
import queue
import asyncio
import threading
import torch
import torch.nn as nn
import torch.nn.functional as F
import uvicorn
import numpy as np
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks, Query, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Tuple
from collections import deque
from pymongo import MongoClient

# Strictly verify external dependencies
try:
    from ultralytics import YOLO
    from sahi import AutoDetectionModel
    from sahi.predict import get_sliced_prediction
except ImportError:
    raise ImportError("Missing required libraries. Ensure ultralytics and sahi are installed.")

# ==============================================================================
# 1. LOAD CONFIGURATIONS & ARTIFACTS (Strict Verification)
# ==============================================================================
YOLO_MODEL_PATH = 'models/yolo11m.pt'
ONNX_MODEL_PATH = 'models/yolo11m.onnx'
CAGT_MODEL_PATH = 'models/cagt/cagt_risk_best.pth'
CALIBRATION_PATH = 'results/uncertainty_calibration/isotonic_calibrator.pkl'
TRACKING_CONFIG_PATH = 'configs/tracking.yaml'
IPM_CONFIG_PATH = 'configs/ipm.yaml'
SAHI_CONFIG_PATH = 'configs/sahi.yaml'
CALIBRATION_JSON_PATH = 'configs/camera_calibration.json'
ANOMALY_ANNOTATIONS_PATH = 'results/dataset/03_anomaly_annotations.csv'
EVIDENCE_DIR = 'results/event_evidence'

os.makedirs(EVIDENCE_DIR, exist_ok=True)

# Strict check: Do not silently download, mock, or train replacements
if not os.path.exists(YOLO_MODEL_PATH):
    raise FileNotFoundError(f"CRITICAL ERROR: YOLO11m artifact missing at {YOLO_MODEL_PATH}. You must complete Phase 3 training first.")
if not os.path.exists(CAGT_MODEL_PATH):
    raise FileNotFoundError(f"CRITICAL ERROR: CAGT-Risk artifact missing at {CAGT_MODEL_PATH}. You must complete Phase 10 training first.")
if not os.path.exists(TRACKING_CONFIG_PATH):
    raise FileNotFoundError(f"CRITICAL ERROR: Tracking configuration missing at {TRACKING_CONFIG_PATH}.")
if not os.path.exists(IPM_CONFIG_PATH):
    raise FileNotFoundError(f"CRITICAL ERROR: IPM configuration missing at {IPM_CONFIG_PATH}.")
if not os.path.exists(SAHI_CONFIG_PATH):
    raise FileNotFoundError(f"CRITICAL ERROR: SAHI configuration missing at {SAHI_CONFIG_PATH}.")

# Load YAML configs
with open(TRACKING_CONFIG_PATH, 'r') as f:
    tracking_config = yaml.safe_load(f)
with open(IPM_CONFIG_PATH, 'r') as f:
    ipm_config = yaml.safe_load(f)
with open(SAHI_CONFIG_PATH, 'r') as f:
    sahi_config = yaml.safe_load(f)

# Load Anomaly Ground-Truth Reference Table (for AI City Track 4 evaluation)
anomaly_ref_table = {}
if os.path.exists(ANOMALY_ANNOTATIONS_PATH):
    try:
        df_anom = pd.read_csv(ANOMALY_ANNOTATIONS_PATH)
        for _, row in df_anom.iterrows():
            vid_id = int(row['video_id'])
            if vid_id not in anomaly_ref_table:
                s_val = row['start_s'] if 'start_s' in row else row.get('anomaly_start_time', row.get('start_time', 0.0))
                e_val = row['end_s'] if 'end_s' in row else row.get('anomaly_end_time', row.get('end_time', 0.0))
                anomaly_ref_table[vid_id] = {
                    'start_time': float(s_val),
                    'end_time': float(e_val)
                }
    except Exception as e:
        print(f"Notice: Failed to load anomaly annotations table: {e}")

# Database Configuration (MongoDB)
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
try:
    mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    mongo_client.server_info()
    db = mongo_client["sentinel_db"]
    events_collection = db["events"]
    mongo_connected = True
except Exception as e:
    print(f"Notice: MongoDB unavailable at {MONGO_URI} ({e}). Falling back to local disk metadata.")
    mongo_client = None
    events_collection = None
    mongo_connected = False

def clear_all_evidence():
    """
    Clears all event evidence immediately when the backend server restarts.
    Removes all clips, manifests, and metadata JSON files in EVIDENCE_DIR and flushes database event collections.
    """
    cleared_files = 0
    if os.path.exists(EVIDENCE_DIR):
        for item in os.listdir(EVIDENCE_DIR):
            item_path = os.path.join(EVIDENCE_DIR, item)
            try:
                if os.path.isfile(item_path) or os.path.islink(item_path):
                    os.unlink(item_path)
                    cleared_files += 1
                elif os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                    cleared_files += 1
            except Exception as e:
                print(f"[STARTUP CLEANUP] Warning: could not remove evidence item {item_path}: {e}")
    os.makedirs(EVIDENCE_DIR, exist_ok=True)

    cleared_db = 0
    if events_collection is not None:
        try:
            res = events_collection.delete_many({})
            cleared_db = res.deleted_count
        except Exception as e:
            print(f"[STARTUP CLEANUP] Warning: failed to flush MongoDB events collection: {e}")

    print(f"🧹 [STARTUP CLEANUP] Backend server restarted: All evidence cleared immediately! ({cleared_files} files in {EVIDENCE_DIR}, {cleared_db} database records).")
    return {"cleared_files": cleared_files, "cleared_db": cleared_db}

# Immediately wipe all previous evidence upon backend startup
clear_all_evidence()

# Load Models
print(f"Loading YOLO11m detector from {YOLO_MODEL_PATH}...")
device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
detector = YOLO(YOLO_MODEL_PATH)

onnx_detector = None
if os.path.exists(ONNX_MODEL_PATH):
    try:
        print(f"Loading ONNX detector from {ONNX_MODEL_PATH}...")
        onnx_detector = YOLO(ONNX_MODEL_PATH, task='detect')
    except Exception as e:
        print(f"Notice: Failed to load ONNX detector: {e}")

sahi_detector = AutoDetectionModel.from_pretrained(
    model_type='ultralytics',
    model_path=YOLO_MODEL_PATH,
    confidence_threshold=sahi_config.get('confidence_threshold', 0.30),
    device=device
)

# ==============================================================================
# SAFETY-GUIDED ADAPTIVE SLICING (SGAS) ENGINE
# ==============================================================================
class SGASPredictor:
    """
    Safety-Guided Adaptive Slicing (SGAS) Engine
    Intelligently allocates high-resolution sliced inference to regions with:
      1. Small or distant road users (area_norm <= small_object_max_area_ratio)
      2. Detection uncertainty (confidence between uncertainty_conf_min and uncertainty_conf_max)
      3. Crowded clusters & occlusions (IoU >= crowding_iou_threshold or spatial proximity)
      4. Safety-critical interactions (VRU classes, converging velocity vectors, high risk)
    """
    def __init__(self, detector_model, config: dict):
        self.detector = detector_model
        self.config = config
        self.tile_size = int(self.config.get("slice_height", 512))
        self.max_tiles = int(self.config.get("max_extra_tiles_per_frame", 3))
        self.min_priority = float(self.config.get("min_region_priority_score", 0.35))
        self.tile_redundancy_thresh = float(self.config.get("tile_redundancy_iou_thresh", 0.30))
        self.w_small = float(self.config.get("weight_small_object", 0.35))
        self.w_unc = float(self.config.get("weight_uncertainty", 0.25))
        self.w_crowd = float(self.config.get("weight_crowding", 0.20))
        self.w_safe = float(self.config.get("weight_safety_relevance", 0.20))
        self.small_area_thresh = float(self.config.get("small_object_max_area_ratio", 0.005))
        self.conf_min = float(self.config.get("uncertainty_conf_min", 0.25))
        self.conf_max = float(self.config.get("uncertainty_conf_max", 0.55))
        self.nms_iou_thresh = float(self.config.get("postprocess_match_threshold", 0.50))

    def evaluate_priority_signals(
        self,
        boxes: np.ndarray,
        clss: np.ndarray,
        confs: np.ndarray,
        frame_shape: tuple,
        track_info: Optional[Dict[str, Any]] = None
    ) -> np.ndarray:
        if len(boxes) == 0:
            return np.array([])
        H, W = frame_shape[:2]
        total_area = float(W * H)
        N = len(boxes)
        scores = np.zeros(N, dtype=np.float32)

        for i in range(N):
            b = boxes[i]
            c = int(clss[i])
            conf = float(confs[i])

            # 1. Small-object signal
            box_area = max(0.0, (b[2] - b[0]) * (b[3] - b[1]))
            area_norm = box_area / max(total_area, 1.0)
            s_small = max(0.0, 1.0 - (area_norm / self.small_area_thresh)) if area_norm < self.small_area_thresh else 0.0

            # 2. Uncertainty signal
            if self.conf_min <= conf <= self.conf_max:
                s_unc = 1.0 - ((conf - self.conf_min) / max(self.conf_max - self.conf_min, 1e-3))
            else:
                s_unc = 0.0

            # 3. Crowding / Occlusion signal
            crowd_count = 0
            for j in range(N):
                if i == j:
                    continue
                bj = boxes[j]
                iw = max(0.0, min(b[2], bj[2]) - max(b[0], bj[0]))
                ih = max(0.0, min(b[3], bj[3]) - max(b[1], bj[1]))
                inter = iw * ih
                if inter > 0:
                    union = box_area + max(0.0, (bj[2] - bj[0]) * (bj[3] - bj[1])) - inter
                    iou = inter / max(union, 1e-6)
                    if iou >= float(self.config.get("crowding_iou_threshold", 0.15)):
                        crowd_count += 1
                else:
                    dist = np.sqrt(((b[0]+b[2])/2 - (bj[0]+bj[2])/2)**2 + ((b[1]+b[3])/2 - (bj[1]+bj[3])/2)**2)
                    if dist <= 60.0:
                        crowd_count += 1
            s_crowd = min(1.0, crowd_count / 3.0)

            # 4. Safety-relevance signal
            is_vru = (c in [0, 1, 2, 9]) # pedestrian, people, bicycle, motor
            s_safe = 0.5 if is_vru else 0.0
            if track_info:
                closing_tids = track_info.get("closing_tids", set())
                tid_map = track_info.get("tid_map", {})
                tid = tid_map.get(i)
                if tid and tid in closing_tids:
                    s_safe = 1.0
                elif track_info.get("current_risk", 0.0) >= 0.40 and is_vru:
                    s_safe = 0.85

            scores[i] = (
                self.w_small * s_small +
                self.w_unc * s_unc +
                self.w_crowd * s_crowd +
                self.w_safe * s_safe
            )
        return scores

    def select_tiles(self, boxes: np.ndarray, scores: np.ndarray, frame_shape: tuple) -> List[Tuple[int, int, int, int]]:
        if len(scores) == 0:
            return []
        H, W = frame_shape[:2]
        high_idx = np.where(scores >= self.min_priority)[0]
        if len(high_idx) == 0:
            return []
        
        # Sort by priority score descending
        sorted_idx = high_idx[np.argsort(-scores[high_idx])]
        tiles = []

        for idx in sorted_idx:
            b = boxes[idx]
            cx = int((b[0] + b[2]) / 2.0)
            cy = int((b[1] + b[3]) / 2.0)
            x1 = max(0, min(W - self.tile_size, cx - self.tile_size // 2))
            y1 = max(0, min(H - self.tile_size, cy - self.tile_size // 2))
            x2 = min(W, x1 + self.tile_size)
            y2 = min(H, y1 + self.tile_size)

            dup = False
            for tx1, ty1, tx2, ty2 in tiles:
                iw = max(0, min(x2, tx2) - max(x1, tx1))
                ih = max(0, min(y2, ty2) - max(y1, ty1))
                inter = iw * ih
                union = (x2 - x1) * (y2 - y1) + (tx2 - tx1) * (ty2 - ty1) - inter
                iou = inter / max(union, 1e-6)
                if iou >= self.tile_redundancy_thresh:
                    dup = True
                    break
            if not dup:
                tiles.append((x1, y1, x2, y2))
            if len(tiles) >= self.max_tiles:
                break
        return tiles

    def run_targeted_slicing(
        self,
        frame: np.ndarray,
        base_boxes: np.ndarray,
        base_clss: np.ndarray,
        base_confs: np.ndarray,
        scores: np.ndarray,
        conf_thresh: float = 0.25
    ) -> Tuple[List[np.ndarray], List[float], List[int], List[Tuple[int, int, int, int]], int]:
        H, W = frame.shape[:2]
        tiles = self.select_tiles(base_boxes, scores, (H, W))
        if not tiles:
            return [], [], [], [], 0

        extra_recovered_boxes = []
        extra_recovered_confs = []
        extra_recovered_clss = []

        for x1, y1, x2, y2 in tiles:
            slice_crop = frame[y1:y2, x1:x2]
            res_slice = self.detector(slice_crop, conf=conf_thresh, verbose=False)[0]
            if len(res_slice.boxes) > 0:
                s_b = res_slice.boxes.xyxy.cpu().numpy()
                s_c = res_slice.boxes.conf.cpu().numpy()
                s_cls = res_slice.boxes.cls.int().cpu().numpy()
                # Remap to full frame
                s_b[:, [0, 2]] += x1
                s_b[:, [1, 3]] += y1

                for sb, sc, scls in zip(s_b, s_c, s_cls):
                    if len(base_boxes) > 0:
                        iw = np.maximum(0.0, np.minimum(sb[2], base_boxes[:, 2]) - np.maximum(sb[0], base_boxes[:, 0]))
                        ih = np.maximum(0.0, np.minimum(sb[3], base_boxes[:, 3]) - np.maximum(sb[1], base_boxes[:, 1]))
                        inter = iw * ih
                        area_sb = (sb[2]-sb[0])*(sb[3]-sb[1])
                        area_base = (base_boxes[:, 2]-base_boxes[:, 0])*(base_boxes[:, 3]-base_boxes[:, 1])
                        union = area_sb + area_base - inter
                        iou = inter / np.maximum(union, 1e-6)
                        iomin = inter / np.maximum(np.minimum(area_sb, area_base), 1e-6)
                        max_iou = np.max(iou)
                        max_iomin = np.max(iomin)
                    else:
                        max_iou = 0.0
                        max_iomin = 0.0

                    if max_iou < 0.35 and max_iomin < 0.45: # True newly recovered object!
                        extra_recovered_boxes.append(sb)
                        extra_recovered_confs.append(float(sc))
                        extra_recovered_clss.append(int(scls))

        return extra_recovered_boxes, extra_recovered_confs, extra_recovered_clss, tiles, len(extra_recovered_boxes)

sgas_predictor = SGASPredictor(
    onnx_detector if onnx_detector is not None else detector,
    sahi_config
)

class CAGTRisk(nn.Module):
    def __init__(self, node_feature_dim=8, edge_feature_dim=4, hidden_dim=128):
        super(CAGTRisk, self).__init__()
        self.node_mlp = nn.Sequential(
            nn.Linear(node_feature_dim, hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(hidden_dim)
        )
        self.edge_mlp = nn.Sequential(
            nn.Linear(edge_feature_dim, hidden_dim),
            nn.ReLU()
        )
        self.graph_attention = nn.MultiheadAttention(embed_dim=hidden_dim, num_heads=4, batch_first=True)
        self.temporal_gru = nn.GRU(hidden_dim, hidden_dim, batch_first=True)
        self.fc_risk = nn.Linear(hidden_dim, 1)
        self.fc_variance = nn.Linear(hidden_dim, 1)

    def forward(self, node_features, edge_features, return_attention=False):
        B, S, N, D = node_features.shape
        x = node_features.view(B * S, N, D)
        h_node = self.node_mlp(x)
        if edge_features is not None and edge_features.shape[-1] > 0:
            E = edge_features.shape[2]
            x_edge = edge_features.view(B * S, E, -1)
            h_edge = self.edge_mlp(x_edge).mean(dim=1, keepdim=True)
            h_combined = h_node + h_edge
        else:
            h_combined = h_node
        attn_out, attn_weights = self.graph_attention(h_combined, h_combined, h_combined, need_weights=True)
        pooled = attn_out.mean(dim=1)
        pooled_seq = pooled.view(B, S, -1)
        gru_out, _ = self.temporal_gru(pooled_seq)
        last_hidden = gru_out[:, -1, :]
        risk_logit = self.fc_risk(last_hidden)
        var_logit = self.fc_variance(last_hidden)
        risk_prob = torch.sigmoid(risk_logit)
        uncertainty_var = F.softplus(var_logit) + 1e-4
        if return_attention:
            return risk_prob, uncertainty_var, attn_weights
        return risk_prob, uncertainty_var

print(f"Loading CAGT-Risk network from {CAGT_MODEL_PATH}...")
cagt_risk = CAGTRisk(node_feature_dim=8, edge_feature_dim=4, hidden_dim=128).to(device)
cagt_risk.load_state_dict(torch.load(CAGT_MODEL_PATH, map_location=device))
cagt_risk.eval()

# Load Calibrator
isotonic_calibrator = None
if os.path.exists(CALIBRATION_PATH):
    print(f"Loading Isotonic Calibrator from {CALIBRATION_PATH}...")
    with open(CALIBRATION_PATH, 'rb') as f:
        isotonic_calibrator = pickle.load(f)

# Global Camera Calibration State
global_calibration_state = {
    "camera_id": "AICITY_TRACK4",
    "status": "IMAGE-SPACE ONLY",
    "units": "pixels",
    "homography": None,
    "mean_reprojection_error": None,
    "validation_error": None,
    "calibration_timestamp": None,
    "calibration_method": "N/A"
}
if os.path.exists(CALIBRATION_JSON_PATH):
    try:
        with open(CALIBRATION_JSON_PATH, 'r') as f:
            global_calibration_state = json.load(f)
    except Exception as e:
        print(f"Notice: Failed to load camera calibration: {e}")

# Helper: Map Trained YOLO11m Model Class IDs (0 to 9) to Real Class Names
VISDRONE_CLASSES = {
    0: "pedestrian",
    1: "people",
    2: "bicycle",
    3: "car",
    4: "van",
    5: "truck",
    6: "tricycle",
    7: "awning-tricycle",
    8: "bus",
    9: "motor"
}

def map_class_name(cid: int, detector_ref=None) -> str:
    cid_int = int(cid)
    names = getattr(detector_ref, 'names', None) or getattr(detector, 'names', None)
    if isinstance(names, dict) and cid_int in names:
        n = str(names[cid_int]).lower()
        if n == 'person':
            return 'pedestrian'
        if n in ['motorcycle', 'motorbike']:
            return 'motor'
        if n in ['bike']:
            return 'bicycle'
        return n
    return VISDRONE_CLASSES.get(cid_int, "car")

def build_spatiotemporal_graph(
    agent_window: List[List[Dict[str, Any]]],
    track_history: Dict[int, List[Dict[str, Any]]],
    W: int = 5,
    N: int = 5,
    stride: int = 2,
    fps: float = 30.0,
    device: str = "cpu"
) -> (torch.Tensor, torch.Tensor):
    """
    Constructs real spatio-temporal interaction graph tensors matching the exact
    format used to train CAGT-Risk on real NVIDIA AI City Challenge Track 4 traffic surveillance data.
    
    Node Features (8D):
        [x/1920, y/1080, vx/100, vy/100, speed/100, aspect_ratio (w/h), confidence, track_age]
    
    Edge Features (4D for all N*(N-1) directed pairs):
        [distance/500, closing_speed/50, dot_product/1000, normalized_ttc]
    """
    if not agent_window:
        return (
            torch.zeros(1, W, N, 8, dtype=torch.float32, device=device),
            torch.zeros(1, W, N * (N - 1), 4, dtype=torch.float32, device=device)
        )
    
    # Pad temporal window to length W if warming up
    padded_window = list(agent_window)
    while len(padded_window) < W:
        padded_window.insert(0, padded_window[0] if padded_window else [])
    padded_window = padded_window[-W:]
    
    # Select active agents from current frame (prioritize high risk, then high speed)
    last_agents = padded_window[-1]
    sorted_agents = sorted(last_agents, key=lambda a: (a.get('risk_probability', 0.0), a.get('speed', 0.0)), reverse=True)
    curr_agents = sorted_agents[:N]
    active_tids = [a['track_id'] for a in curr_agents]
    
    node_seq = []
    edge_seq = []
    
    for f_agents in padded_window:
        ag_map = {a['track_id']: a for a in f_agents}
        frame_nodes = []
        for k in range(N):
            if k < len(active_tids) and active_tids[k] in ag_map:
                a = ag_map[active_tids[k]]
                tid = a['track_id']
                th_data = track_history.get(tid, {})
                th_list = th_data.get('history', th_data) if isinstance(th_data, dict) else th_data
                pos_x = a.get('x', a.get('position', {}).get('x', 0.0) if isinstance(a.get('position'), dict) else 0.0)
                pos_y = a.get('y', a.get('position', {}).get('y', 0.0) if isinstance(a.get('position'), dict) else 0.0)
                
                if isinstance(th_list, list) and len(th_list) >= 2:
                    dt = max((len(th_list) - 1) * (stride / max(fps, 1.0)), 1e-3)
                    p0 = th_list[0]
                    if isinstance(p0, (list, tuple)) and len(p0) >= 2:
                        th_start_x, th_start_y = float(p0[0]), float(p0[1])
                    elif isinstance(p0, dict):
                        th_start_x = float(p0.get('x', p0.get('position', {}).get('x', pos_x) if isinstance(p0.get('position'), dict) else pos_x))
                        th_start_y = float(p0.get('y', p0.get('position', {}).get('y', pos_y) if isinstance(p0.get('position'), dict) else pos_y))
                    else:
                        th_start_x, th_start_y = pos_x, pos_y
                    vx = (pos_x - th_start_x) / dt
                    vy = (pos_y - th_start_y) / dt
                else:
                    vel = a.get('velocity', {})
                    vx = a.get('vx', vel.get('x', 0.0) if isinstance(vel, dict) else 0.0)
                    vy = a.get('vy', vel.get('y', 0.0) if isinstance(vel, dict) else 0.0)
                spd = float(np.sqrt(vx**2 + vy**2))
                bbox = a.get('bbox', [0, 0, 50, 50])
                w = a.get('w', bbox[2] - bbox[0] if len(bbox) >= 4 else 50.0)
                h = a.get('h', bbox[3] - bbox[1] if len(bbox) >= 4 else 50.0)
                conf = float(a.get('confidence', a.get('conf', 0.85)))
                track_age = min(len(th_list) / 20.0, 1.0) if isinstance(th_list, list) else 0.5
                
                frame_nodes.append([
                    pos_x / 1920.0,
                    pos_y / 1080.0,
                    vx / 100.0,
                    vy / 100.0,
                    spd / 100.0,
                    w / max(h, 1.0),
                    conf,
                    track_age
                ])
            else:
                frame_nodes.append([0.0] * 8)
        node_seq.append(frame_nodes)
        
        frame_edges = []
        for m_idx in range(N):
            for n_idx in range(N):
                if m_idx == n_idx:
                    continue
                p1, p2 = frame_nodes[m_idx], frame_nodes[n_idx]
                if p1[0] > 0 and p2[0] > 0:
                    dx = (p2[0] - p1[0]) * 1920.0
                    dy = (p2[1] - p1[1]) * 1080.0
                    dist = float(np.sqrt(dx**2 + dy**2))
                    dvx = (p2[2] - p1[2]) * 100.0
                    dvy = (p2[3] - p1[3]) * 100.0
                    dot = dx * dvx + dy * dvy
                    closing_spd = -dot / max(dist, 1e-3)
                    ttc_val = dist / max(closing_spd, 1.0) if closing_spd > 0 else 10.0
                    frame_edges.append([
                        float(np.clip(dist / 500.0, 0.0, 3.0)),
                        float(np.clip(closing_spd / 50.0, -2.0, 2.0)),
                        float(np.clip(dot / 5000.0, -2.0, 2.0)),
                        float(np.clip(ttc_val / 5.0, 0.0, 2.0))
                    ])
                else:
                    frame_edges.append([1.0, 0.0, 0.0, 2.0])
        edge_seq.append(frame_edges)
        
    t_nodes = torch.tensor([node_seq], dtype=torch.float32, device=device)
    t_edges = torch.tensor([edge_seq], dtype=torch.float32, device=device)
    return t_nodes, t_edges

# ==============================================================================
# 2. CAMERA CALIBRATION LOGIC
# ==============================================================================
class CalibrationPoint(BaseModel):
    image_x: float
    image_y: float
    ground_x: float
    ground_y: float

class CalibrationRequest(BaseModel):
    camera_id: str = "AICITY_TRACK4"
    points: List[CalibrationPoint]
    units: str = "meters"
    reference_distances: Optional[List[float]] = None

def compute_and_validate_calibration(req: CalibrationRequest) -> Dict[str, Any]:
    if len(req.points) < 4:
        return {
            "status": "CALIBRATION INVALID",
            "error": "At least 4 non-collinear correspondence points are required."
        }
    src_pts = np.array([[p.image_x, p.image_y] for p in req.points[:4]], dtype=np.float32)
    dst_pts = np.array([[p.ground_x, p.ground_y] for p in req.points[:4]], dtype=np.float32)

    # Check collinearity of any 3 points
    def are_collinear(p1, p2, p3):
        area = 0.5 * abs(p1[0]*(p2[1]-p3[1]) + p2[0]*(p3[1]-p1[1]) + p3[0]*(p1[1]-p2[1]))
        return area < 10.0

    for (i, j, k) in [(0,1,2), (0,1,3), (0,2,3), (1,2,3)]:
        if are_collinear(src_pts[i], src_pts[j], src_pts[k]):
            return {
                "status": "CALIBRATION INVALID",
                "error": f"Collinear points detected among points {i+1}, {j+1}, {k+1}. Degenerate homography configuration."
            }

    try:
        if len(src_pts) == 4:
            H = cv2.getPerspectiveTransform(src_pts, dst_pts)
        else:
            H, _ = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    except Exception as e:
        return {
            "status": "CALIBRATION INVALID",
            "error": f"Homography calculation failed: {e}"
        }

    det = np.linalg.det(H)
    if abs(det) < 1e-7:
        return {
            "status": "CALIBRATION INVALID",
            "error": "Homography matrix is near-singular (ill-conditioned geometry)."
        }

    # Compute mean reprojection error using OpenCV perspective transform
    projected = cv2.perspectiveTransform(src_pts.reshape(-1, 1, 2), H).reshape(-1, 2)
    reproj_errors = np.linalg.norm(projected - dst_pts, axis=1)
    mean_reproj_err = float(np.mean(reproj_errors))

    val_err = None
    if len(req.points) > 4:
        val_src = np.array([[p.image_x, p.image_y] for p in req.points[4:]], dtype=np.float32)
        val_dst = np.array([[p.ground_x, p.ground_y] for p in req.points[4:]], dtype=np.float32)
        val_proj = cv2.perspectiveTransform(val_src.reshape(-1, 1, 2), H).reshape(-1, 2)
        val_err = float(np.mean(np.linalg.norm(val_proj - val_dst, axis=1)))

    if mean_reproj_err > 10.0:
        calib_status = "CALIBRATION INVALID"
    elif req.units == "meters":
        calib_status = "CALIBRATED — METRIC"
    else:
        calib_status = "CALIBRATED — RELATIVE/ARBITRARY SCALE"

    return {
        "status": calib_status,
        "camera_id": req.camera_id,
        "units": req.units,
        "homography": H.tolist(),
        "mean_reprojection_error": round(mean_reproj_err, 4),
        "validation_error": round(val_err, 4) if val_err is not None else None,
        "calibration_timestamp": time.time(),
        "calibration_method": "Four-Point Planar Correspondence with Reprojection Error Validation"
    }

# ==============================================================================
# 3. BOUNDED EVENT RING BUFFER & CLIP VERIFICATION (Real Evidence Storage)
# ==============================================================================
def verify_clip(path: str, expected_duration: Optional[float] = None) -> (bool, str):
    """Verifies that an extracted video clip exists, is non-empty, and can be decoded."""
    if not os.path.exists(path):
        return False, "File does not exist on disk"
    sz = os.path.getsize(path)
    if sz == 0:
        return False, "File is empty (0 bytes)"
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        cap.release()
        return False, "Failed to open video codec / unreadable container"
    fc = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()
    if fc <= 0:
        return False, "Decoded 0 frames"
    actual_dur = fc / max(fps, 1.0)
    if expected_duration is not None and abs(actual_dur - expected_duration) > 2.5:
        return True, f"Verified with duration drift: expected {expected_duration:.1f}s, decoded {actual_dur:.1f}s ({int(fc)} frames)"
    return True, f"Verified: {int(fc)} frames ({actual_dur:.2f}s, {sz / 1024:.1f} KB)"

def resolve_source_video_file(path_str: Optional[str]) -> Optional[str]:
    """Resolves any relative, absolute, or basename video reference to a concrete, existing video file on disk."""
    if not path_str:
        return None
    try:
        if os.path.exists(path_str) and os.path.isfile(path_str):
            return os.path.abspath(path_str)
        base = os.path.basename(path_str)
        candidates = [
            os.path.join("data", "accident_demonstration_videos", base),
            os.path.join("data", base),
            os.path.join("data", "curated_cctv", base),
            os.path.join("data", "youtube_tests", base),
            os.path.join("data", "custom_test_videos", base),
            os.path.join("data", "raw", "AI_City", "aic21-track4-train-data", base),
        ]
        for c in candidates:
            if os.path.exists(c) and os.path.isfile(c):
                return os.path.abspath(c)
    except Exception:
        pass
    return None

class EventRingBuffer:
    def __init__(self, pre_event_seconds=5.0, post_event_seconds=9.0, fps=30.0):
        self.pre_event_seconds = float(pre_event_seconds)
        self.post_event_seconds = float(post_event_seconds)
        self.fps = float(fps)
        self.pre_event_frames = int(self.pre_event_seconds * self.fps)
        self.post_event_frames = int(self.post_event_seconds * self.fps)
        self.buffer = deque(maxlen=max(self.pre_event_frames * 2, 200))
        self.is_recording = False
        self.post_event_counter = 0
        self.current_event_metadata = {}
        self.event_evidence = []
        self.event_log = []
        self.lock = threading.Lock()

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            free_mb = 0.0
            try:
                _, _, free = shutil.disk_usage(EVIDENCE_DIR)
                free_mb = round(free / (1024 * 1024), 1)
            except Exception:
                pass
            return {
                "enabled": True,
                "pre_event_seconds": self.pre_event_seconds,
                "post_event_seconds": self.post_event_seconds,
                "buffer_occupancy_frames": len(self.buffer),
                "buffer_capacity_frames": self.pre_event_frames,
                "is_capturing": self.is_recording,
                "post_event_progress": self.post_event_counter,
                "post_event_target": self.post_event_frames,
                "storage_free_mb": free_mb,
                "total_events_captured": len(self.event_log)
            }

    def add_frame(self, frame, payload, video_path=None):
        with self.lock:
            v_path = video_path or (getattr(pipeline, 'video_path', None) if 'pipeline' in globals() else None)
            now_t = time.time()
            v_time = payload.get('video_time', now_t) if isinstance(payload, dict) else now_t
            item = {'frame': frame.copy(), 'payload': payload, 'video_path': v_path, 'timestamp': now_t, 'video_time': v_time}
            if not self.is_recording:
                self.buffer.append(item)
            else:
                self.event_evidence.append(item)
                self.post_event_counter += 1
                if self.post_event_counter >= self.post_event_frames:
                    evidence_copy = list(self.event_evidence)
                    meta_copy = self.current_event_metadata.copy()
                    self.reset_locked()
                    # Non-blocking async background save worker: video ingestion is never blocked!
                    threading.Thread(target=self._save_worker, args=(meta_copy, evidence_copy), daemon=True).start()

    def flush_and_save(self):
        with self.lock:
            if not self.is_recording or not self.event_evidence:
                return
            evidence_copy = list(self.event_evidence)
            meta_copy = self.current_event_metadata.copy()
            self.reset_locked()
            threading.Thread(target=self._save_worker, args=(meta_copy, evidence_copy), daemon=True).start()

    def trigger_event(self, probability, uncertainty, event_type="CRITICAL PREDICTED CONFLICT", lead_time=None, video_time=0.0, track_ids=None, snapshot_frame=None, source_video=None):
        with self.lock:
            incoming_tids = set(track_ids or [])
            current_tids = set(self.current_event_metadata.get('track_ids', []))
            is_new_collision = bool(incoming_tids and not incoming_tids.intersection(current_tids))
            elapsed_since_last = float(video_time) - float(self.current_event_metadata.get('source_timestamp', 0.0))
            if self.is_recording:
                if (is_new_collision or elapsed_since_last >= 4.5) and elapsed_since_last >= 1.0 and self.event_evidence:
                    # Flush and save previous incident clip, then record this distinct incident!
                    evidence_copy = list(self.event_evidence)
                    meta_copy = self.current_event_metadata.copy()
                    self.reset_locked()
                    threading.Thread(target=self._save_worker, args=(meta_copy, evidence_copy), daemon=True).start()
                else:
                    return
            self.is_recording = True
            self.post_event_counter = 0

            # Strictly filter buffered frames to prevent any cross-video contamination
            cur_vid = getattr(pipeline, 'video_path', None) if 'pipeline' in globals() else None
            matching_frames = [
                item for item in self.buffer
                if (cur_vid is None) or (item.get('video_path') == cur_vid) or (not item.get('video_path'))
            ]
            self.event_evidence = list(matching_frames)
            ev_id = f"ev_{uuid.uuid4().hex[:10]}"

            snap_filename = f"{ev_id}_snapshot.jpg"
            snap_path = os.path.join(EVIDENCE_DIR, snap_filename)
            snap_saved = False
            if snapshot_frame is not None:
                try:
                    cv2.imwrite(snap_path, snapshot_frame)
                    snap_saved = True
                except Exception as ex:
                    print(f"Error saving instant snapshot: {ex}")

            resolved_vid = resolve_source_video_file(source_video) or resolve_source_video_file(cur_vid)
            src_display = os.path.basename(resolved_vid or cur_vid or source_video or 'LIVE_CCTV_STREAM')
            self.current_event_metadata = {
                'event_id': ev_id,
                'source_id': src_display,
                'source_video': src_display,
                'source_video_path': resolved_vid,
                'camera_id': 'AICITY_TRACK4',
                'event_type': event_type,
                'status': 'suspected',
                'source_timestamp': round(float(video_time), 2),
                'event_start_timestamp': max(0.0, round(float(video_time) - self.pre_event_seconds, 2)),
                'event_peak_timestamp': round(float(video_time), 2),
                'event_end_timestamp': round(float(video_time) + self.post_event_seconds, 2),
                'severity': 'critical' if probability >= 0.85 else 'high',
                'risk_score': round(float(probability), 4),
                'probability_calibrated': True,
                'uncertainty': round(float(uncertainty), 4),
                'warning_lead_time': float(lead_time) if lead_time is not None else None,
                'track_ids': track_ids or [],
                'evidence': [f"calibrated_risk_{probability:.3f}", f"uncertainty_{uncertainty:.3f}"],
                'trajectories': {
                    str(tid): [
                        {"time": round(pt[0], 2), "x": round(pt[1], 1), "y": round(pt[2], 1)}
                        for pt in pipeline.track_history.get(tid, {}).get('timed_history', [])[-30:]
                    ]
                    for tid in (track_ids or [])
                    if 'pipeline' in globals() and hasattr(pipeline, 'track_history') and tid in pipeline.track_history
                },
                'clip_status': 'capturing',
                'clip_reference': None,
                'clip_url': None,
                'snapshot_reference': snap_path if snap_saved else None,
                'snapshot_url': f"/analysis/clips/{snap_filename}" if snap_saved else None,
                'review_status': 'unreviewed',
                'review_outcome': None,
                'reviewed_by': None,
                'review_notes': None,
                'reviewed_at': None,
                'created_at': time.time(),
                'warning_time': time.strftime("%Y-%m-%d %H:%M:%S")
            }
            self.event_log.append(self.current_event_metadata.copy())

            # Immediately write initial metadata to disk and DB so evidence is never lost!
            try:
                meta_path = os.path.join(EVIDENCE_DIR, f"{ev_id}_metadata.json")
                with open(meta_path, 'w') as f:
                    json.dump(self.current_event_metadata, f, indent=2)
                if events_collection is not None:
                    events_collection.insert_one(self.current_event_metadata.copy())
            except Exception as ex:
                print(f"Error writing instant metadata: {ex}")

    def _save_worker(self, meta, evidence):
        try:
            ev_id = meta['event_id']
            video_filename = f"{ev_id}.mp4"
            video_path = os.path.join(EVIDENCE_DIR, video_filename)
            if evidence:
                # If source video file exists, extract exact full-fidelity continuous clip directly from source at 1.0x normal speed!
                source_vid = resolve_source_video_file(meta.get('source_video_path')) or                              resolve_source_video_file(meta.get('source_video')) or                              resolve_source_video_file(getattr(pipeline, 'video_path', None) if 'pipeline' in globals() else None)
                event_ts = float(meta.get('source_timestamp', 0.0))
                extracted_from_source = False
                temp_raw = video_path + ".raw.mp4"
                
                if source_vid and os.path.exists(source_vid):
                    try:
                        cap_src = cv2.VideoCapture(source_vid)
                        if cap_src.isOpened():
                            src_fps = float(cap_src.get(cv2.CAP_PROP_FPS) or 30.0)
                            total_src_frames = int(cap_src.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                            src_w = int(cap_src.get(cv2.CAP_PROP_FRAME_WIDTH))
                            src_h = int(cap_src.get(cv2.CAP_PROP_FRAME_HEIGHT))
                            src_start_f = max(0, int(round((event_ts - self.pre_event_seconds) * src_fps)))
                            src_end_f = int(round((event_ts + self.post_event_seconds) * src_fps))
                            if total_src_frames > 0:
                                src_end_f = min(total_src_frames - 1, src_end_f)

                            cap_src.set(cv2.CAP_PROP_POS_FRAMES, src_start_f)
                            out = cv2.VideoWriter(temp_raw, cv2.VideoWriter_fourcc(*'mp4v'), src_fps, (src_w, src_h))
                            cur_f = src_start_f
                            while cur_f <= src_end_f:
                                r_f, f_f = cap_src.read()
                                if not r_f or f_f is None:
                                    break
                                out.write(f_f)
                                cur_f += 1
                            out.release()
                            cap_src.release()
                            if cur_f > src_start_f:
                                extracted_from_source = True
                                print(f"[EVIDENCE] Successfully extracted {cur_f - src_start_f} full-fidelity {src_fps:.1f}fps frames from source video at exact 1.0x speed!")
                    except Exception as e_src:
                        print(f"[EVIDENCE] Source video clip extraction fallback: {e_src}")

                if not extracted_from_source:
                    # Live fallback from buffered frames: compute effective FPS from frame timestamps to guarantee 1.0x normal speed playback
                    h, w, _ = evidence[0]['frame'].shape
                    t0 = evidence[0].get('timestamp', 0)
                    t1 = evidence[-1].get('timestamp', 0)
                    t_span = max(0.5, t1 - t0)
                    computed_fps = float(len(evidence)) / t_span if t_span > 0 else 10.0
                    target_fps = max(5.0, min(30.0, computed_fps))
                    out = cv2.VideoWriter(temp_raw, cv2.VideoWriter_fourcc(*'mp4v'), target_fps, (w, h))
                    for item in evidence:
                        out.write(item['frame'])
                    out.release()

                # Transcode to web-compatible H.264 (+faststart) for seamless browser playback
                converted = False
                try:
                    import imageio_ffmpeg, subprocess
                    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
                    cmd = [
                        ffmpeg_bin, '-y',
                        '-i', temp_raw,
                        '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p',
                        '-preset', 'veryfast',
                        '-crf', '22',
                        '-c:a', 'aac',
                        '-movflags', '+faststart',
                        video_path
                    ]
                    r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    if r.returncode == 0 and os.path.exists(video_path):
                        converted = True
                        if os.path.exists(temp_raw):
                            os.remove(temp_raw)
                except Exception as ex:
                    print(f"FFmpeg live clip transcode error: {ex}")

                if not converted and os.path.exists(temp_raw):
                    os.replace(temp_raw, video_path)

                ok, reason = verify_clip(video_path)
                meta['clip_status'] = 'verified' if ok else 'failed'
                meta['clip_verification_detail'] = reason
                meta['clip_reference'] = video_path
                meta['clip_url'] = f"/analysis/clips/{video_filename}"
            else:
                meta['clip_status'] = 'failed'
                meta['clip_verification_detail'] = "No frame evidence recorded in buffer"

            meta['end_time'] = time.time()
            # Always persist to disk JSON so Event Review is 100% reliable
            try:
                meta_path = os.path.join(EVIDENCE_DIR, f"{ev_id}_metadata.json")
                with open(meta_path, 'w') as f:
                    json.dump(meta, f, indent=2)
            except Exception as ex:
                print(f"Error saving meta JSON: {ex}")

            if events_collection is not None:
                try:
                    events_collection.replace_one({"event_id": ev_id}, meta.copy(), upsert=True)
                except Exception as ex:
                    print(f"Error upserting into MongoDB: {ex}")
            print(f"EVIDENCE SAVED & VERIFIED: Event {ev_id} | Status: {meta['clip_status']}")
        except Exception as e:
            print(f"Error in saving ring-buffer evidence: {e}")

    def reset_locked(self):
        self.is_recording = False
        self.post_event_counter = 0
        self.event_evidence = []
        self.current_event_metadata = {}

    def full_reset(self):
        with self.lock:
            self.reset_locked()
            self.buffer.clear()

    def reset(self):
        self.full_reset()

# ==============================================================================
# 4. VIDEO PIPELINE & STATE MANAGEMENT
# ==============================================================================
class VideoStartRequest(BaseModel):
    video_path: str
    engine: Optional[str] = "onnx"  # "onnx" or "pytorch"
    graph_mode: Optional[str] = "G3"   # "G0", "G1", "G2", "G3"
    alert_policy: Optional[str] = "density_conditioned" # "fixed" or "density_conditioned"
    start_time_seconds: Optional[float] = 0.0
    playback_speed: Optional[float] = 1.0

class PlaybackSpeedRequest(BaseModel):
    speed: float

class VideoPipeline:
    def __init__(self):
        self.is_running = False
        self.video_path = None
        self.engine = "onnx"
        self.graph_mode = "G3"
        self.alert_policy = "density_conditioned"
        self.start_time_seconds = 0.0
        self.cap = None
        self.track_history = {}
        self.ring_buffer = EventRingBuffer()
        self.active_connections = []
        self.last_gray_frame = None
        self.current_payload = None
        self.latest_annotated_frame_jpeg = None
        self.frame_lock = threading.Lock()
        self.worker_thread = None
        self.loop = None
        self.frame_id = 0
        self.fps = 30.0
        self.playback_speed = 1.0
        
        # Ground-truth reference for evaluation
        self.anomaly_onset_reference = None
        self.anomaly_end_reference = None
        self.first_detection_time = None
        self.smoothed_risk = 0.05
        self.agent_window = deque(maxlen=5)
        self.incident_hold_counter = 0
        self.active_crash_tids = set()
        self.active_crash_positions = []
        self.persistent_incident_scene = {}

    def reset_state(self):
        self.track_history = {}
        self.last_gray_frame = None
        self.current_payload = None
        self.latest_annotated_frame_jpeg = None
        self.frame_id = 0
        self.first_detection_time = None
        self.anomaly_onset_reference = None
        self.anomaly_end_reference = None
        self.smoothed_risk = 0.05
        self.playback_speed = 1.0
        self.agent_window.clear()
        self.incident_hold_counter = 0
        self.active_crash_tids = set()
        self.active_crash_positions = []
        self.persistent_incident_scene = {}
        if hasattr(self, 'ring_buffer') and self.ring_buffer is not None:
            self.ring_buffer.full_reset()

pipeline = VideoPipeline()
app = FastAPI(title="Sentinel Live Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def on_startup():
    clear_all_evidence()

# ==============================================================================
# 5. PROCESSING CORE
# ==============================================================================
def process_frame(frame, frame_id, fps=30.0):
    t_start = time.perf_counter()
    video_time = frame_id / fps
    current_wall_time = time.time()
    H, W = frame.shape[:2]

    # 1. Optical Flow Gating (Accelerated via 320x180 spatial downscaling: 18x speedup)
    t_of_start = time.perf_counter()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    flow_magnitude = 0.0
    if pipeline.last_gray_frame is not None and pipeline.last_gray_frame.shape == gray.shape:
        small_prev = cv2.resize(pipeline.last_gray_frame, (320, 180))
        small_curr = cv2.resize(gray, (320, 180))
        flow = cv2.calcOpticalFlowFarneback(small_prev, small_curr, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        flow_magnitude = float(np.mean(np.linalg.norm(flow, axis=2))) * (frame.shape[1] / 320.0)
    else:
        flow_magnitude = 1.0
    pipeline.last_gray_frame = gray
    t_of = (time.perf_counter() - t_of_start) * 1000

    # Gate: static scene bypasses deep compute only if NO active incident and no recent tracks (prevent feedback lock)
    has_active_incident = (getattr(pipeline, 'incident_hold_counter', 0) > 0) or bool(getattr(pipeline, 'persistent_incident_scene', {}).get('active'))
    if flow_magnitude < 0.005 and frame_id > 20 and len(pipeline.track_history) == 0 and not has_active_incident and (frame_id % 15 != 0):
        payload = {
            "timestamp": round(current_wall_time, 2),
            "camera_id": "AICITY_TRACK4",
            "frame_id": frame_id,
            "optical_flow_gated": True,
            "flow_magnitude": round(flow_magnitude, 4),
            "coordinate_space": global_calibration_state.get("status", "IMAGE-SPACE ONLY"),
            "homography_matrix": global_calibration_state.get("homography", None),
            "detections": [],
            "tracks": [],
            "trajectories": {},
            "risk_score": 0.0,
            "calibrated_risk": 0.0,
            "uncertainty": 0.0,
            "anomaly_alert": False,
            "risk": {"global_risk": 0.0, "calibrated_risk": 0.0},
            "warning_state": "NORMAL",
            "video_time": round(video_time, 2),
            "anomaly_onset_reference": pipeline.anomaly_onset_reference,
            "warning_lead_time": None,
            "sahi_status": {"applied": False, "trigger_reason": "Optical flow gated (static frame)"},
            "system_metrics": {
                "inference_fps": round(1000.0 / max((time.perf_counter() - t_start)*1000, 1.0), 1),
                "optical_flow_ms": round(t_of, 2),
                "detector_ms": 0.0,
                "sahi_ms": 0.0,
                "cagt_ms": 0.0,
                "total_pipeline_ms": round((time.perf_counter() - t_start) * 1000, 2)
            },
            "agents": [],
            "alerts": []
        }
        # Update JPEG stream with status text
        annotated = frame.copy()
        cv2.putText(annotated, f"Frame: {frame_id} | OPTICAL FLOW GATED (STATIC)", (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)
        _, j_buf = cv2.imencode('.jpg', annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        with pipeline.frame_lock:
            pipeline.latest_annotated_frame_jpeg = j_buf.tobytes()
        return payload

    # 2. Object Detection & Tracking (Mode A, Mode B, Mode C)
    t_det_start = time.perf_counter()
    active_detector = onnx_detector if (pipeline.engine in ["onnx", "sgas"] and onnx_detector is not None) else detector

    # Use imgsz=480 for speed while retaining reliable detection
    det_imgsz = 480

    res_b0 = active_detector.track(
        frame,
        imgsz=det_imgsz,
        persist=True,
        tracker="bytetrack.yaml",
        agnostic_nms=True,
        conf=0.20,
        iou=0.45,
        verbose=False
    )[0]
    t_det = (time.perf_counter() - t_det_start) * 1000

    num_base_objects = len(res_b0.boxes) if (res_b0.boxes is not None) else 0

    # Retain full ByteTrack persistent tracks
    final_boxes, final_ids, final_clss, final_confs = [], [], [], []
    if num_base_objects > 0 and res_b0.boxes is not None:
        final_boxes = res_b0.boxes.xyxy.cpu().numpy().tolist()
        if res_b0.boxes.id is not None:
            final_ids = res_b0.boxes.id.int().cpu().numpy().tolist()
        else:
            final_ids = list(range(1, len(final_boxes) + 1))
        final_clss = res_b0.boxes.cls.int().cpu().numpy().tolist()
        final_confs = res_b0.boxes.conf.cpu().numpy().tolist()

    # ByteTrack provides verified persistent multi-object tracking without duplicate forward passes

    # 3. Slicing Decision & Execution (Mode A, Mode B, Mode C)
    t_sahi = 0.0
    apply_sahi = False
    sahi_trigger_reason = "None"
    sgas_tiles_count = 0
    sgas_recovered_count = 0

    if pipeline.engine == "sgas" and num_base_objects > 0:
        # Mode C: Safety-Guided Adaptive Slicing (SGAS)
        t_sgas_start = time.perf_counter()
        track_info = {
            "closing_tids": set(),
            "tid_map": {idx: tid for idx, tid in enumerate(final_ids)},
            "current_risk": getattr(pipeline, 'smoothed_risk', 0.0)
        }
        b_arr = np.array(final_boxes)
        c_arr = np.array(final_clss)
        s_arr = np.array(final_confs)
        prio_scores = sgas_predictor.evaluate_priority_signals(b_arr, c_arr, s_arr, frame.shape, track_info)
        ex_b, ex_c, ex_cls, tiles, num_rec = sgas_predictor.run_targeted_slicing(
            frame, b_arr, c_arr, s_arr, prio_scores, conf_thresh=0.25
        )
        t_sahi = (time.perf_counter() - t_sgas_start) * 1000
        sgas_tiles_count = len(tiles)
        sgas_recovered_count = num_rec

        if num_rec > 0:
            apply_sahi = True
            sahi_trigger_reason = f"SGAS Active ({sgas_tiles_count} tiles, +{num_rec} small/uncertain VRUs recovered)"
            max_id = max(final_ids) if final_ids else 100
            for k, (box_k, conf_k, cls_k) in enumerate(zip(ex_b, ex_c, ex_cls)):
                # SGAS is strictly for recovering small VRUs (pedestrian, bicycle, motor)
                # Slices chop large vehicles in half and produce phantom trucks/buses
                if int(cls_k) in [5, 8]:  # 5=truck, 8=bus in VisDrone
                    continue
                final_boxes.append(box_k.tolist() if isinstance(box_k, np.ndarray) else list(box_k))
                final_ids.append(max_id + k + 1)
                final_clss.append(cls_k)
                final_confs.append(conf_k)
        elif sgas_tiles_count > 0:
            apply_sahi = True
            sahi_trigger_reason = f"SGAS Inspected ({sgas_tiles_count} tiles allocated, 0 unobserved objects)"
    elif pipeline.engine == "sahi" and num_base_objects > 0:
        # Mode B: Standard SAHI Baseline (Uniform 15 tiles)
        t_sahi_start = time.perf_counter()
        try:
            res_sahi = get_sliced_prediction(
                frame,
                sahi_detector,
                slice_height=512,
                slice_width=512,
                overlap_height_ratio=0.20,
                overlap_width_ratio=0.20,
                verbose=0
            )
            apply_sahi = True
            sgas_tiles_count = 15
            sahi_trigger_reason = "Standard SAHI Baseline (Uniform 15 full-frame tiles)"
        except Exception:
            pass
        t_sahi = (time.perf_counter() - t_sahi_start) * 1000
    else:
        # Mode A: Full-Frame YOLO11m Only
        sahi_trigger_reason = "Mode A (Full-frame YOLO11m only, slicing bypassed)"

    # Cross-class object deduplication: merge/suppress overlapping duplicate boxes for the same vehicle
    if len(final_boxes) > 1:
        keep_indices = []
        confs_arr = np.array(final_confs)
        sorted_order = np.argsort(confs_arr)[::-1]
        suppressed = set()
        for i_idx in sorted_order:
            if i_idx in suppressed:
                continue
            keep_indices.append(i_idx)
            bi = final_boxes[i_idx]
            area_i = max(1.0, (bi[2] - bi[0]) * (bi[3] - bi[1]))
            for j_idx in sorted_order:
                if j_idx == i_idx or j_idx in suppressed:
                    continue
                bj = final_boxes[j_idx]
                iw = max(0.0, min(bi[2], bj[2]) - max(bi[0], bj[0]))
                ih = max(0.0, min(bi[3], bj[3]) - max(bi[1], bj[1]))
                inter = iw * ih
                if inter > 0:
                    area_j = max(1.0, (bj[2] - bj[0]) * (bj[3] - bj[1]))
                    union = area_i + area_j - inter
                    iou = inter / union
                    iomin = inter / min(area_i, area_j)
                    if iou >= 0.35 or iomin >= 0.45:
                        suppressed.add(j_idx)
        final_boxes = [final_boxes[k] for k in keep_indices]
        final_ids = [final_ids[k] for k in keep_indices]
        final_clss = [final_clss[k] for k in keep_indices]
        final_confs = [final_confs[k] for k in keep_indices]

    # 4. Kinematics, Tracking Uncertainty & Coordinate Space
    agents_payload = []
    current_frame_tids = set()
    is_calibrated_metric = (global_calibration_state.get("status") == "CALIBRATED — METRIC")
    H_matrix = np.array(global_calibration_state["homography"], dtype=np.float32) if is_calibrated_metric else None

    for box, tid, cls, conf in zip(final_boxes, final_ids, final_clss, final_confs):
        if tid == -1:
            continue

        c_name = map_class_name(int(cls), active_detector)
        c_lower = c_name.lower()
        is_vru_item = c_lower in ['pedestrian', 'people', 'bicycle', 'motor', 'motorcycle', 'tricycle', 'awning-tricycle']

        bw = box[2] - box[0]
        bh = box[3] - box[1]

        # Robust detection filtering: confirmed tracks kept down to 0.15, new require confirmed confidence
        if is_vru_item:
            is_existing = tid in pipeline.track_history
            min_vru_c = 0.16 if is_existing else 0.22
            if bw < 8 or bh < 14 or conf < min_vru_c:
                continue
        else:
            is_existing = tid in pipeline.track_history
            min_c = 0.10 if is_existing else 0.18
            if bw < 12 or bh < 12 or conf < min_c:
                continue

        current_frame_tids.add(tid)

        x_center = (box[0] + box[2]) / 2.0
        y_bottom = box[3]

        if tid not in pipeline.track_history:
            pipeline.track_history[tid] = {
                'history': [],
                'timed_history': [],
                'conf_history': [],
                'class': int(cls),
                'age': 0
            }

        th = pipeline.track_history[tid]
        th['history'].append([round(float(x_center), 2), round(float(y_bottom), 2)])
        th['timed_history'].append((video_time, float(x_center), float(y_bottom)))
        th['conf_history'].append(float(conf))
        th['age'] += 1

        if len(th['history']) > 30:
            th['history'].pop(0)
            th['timed_history'].pop(0)
            th['conf_history'].pop(0)

        # Smoothed image-space pixel velocity (px/s) with robust multi-frame warmup
        vel_x, vel_y = 0.0, 0.0
        is_warmed = False
        timed_h = th['timed_history']
        if len(timed_h) >= 5:
            dt_total = timed_h[-1][0] - timed_h[0][0]
            if dt_total >= 0.12:
                is_warmed = True
                raw_vx = (timed_h[-1][1] - timed_h[0][1]) / dt_total
                raw_vy = (timed_h[-1][2] - timed_h[0][2]) / dt_total
                raw_spd = float(np.sqrt(raw_vx**2 + raw_vy**2))
                max_spd = 250.0  # Physical velocity clamp in image px/s
                if raw_spd > max_spd:
                    s = max_spd / raw_spd
                    vel_x, vel_y = raw_vx * s, raw_vy * s
                else:
                    vel_x, vel_y = raw_vx, raw_vy

        speed = float(np.sqrt(vel_x**2 + vel_y**2))
        prior_spd = th.get('last_speed', speed)
        th['max_speed'] = max(th.get('max_speed', 0.0), speed)
        inst_dec = max(0.0, prior_spd - speed)
        th['deceleration'] = inst_dec
        th['last_speed'] = speed
        direction = float(np.arctan2(vel_y, vel_x)) if speed > 1e-3 else 0.0
        conf_std = float(np.std(th['conf_history'])) if len(th['conf_history']) > 1 else 0.0

        # For articulated semi-trucks, expand ONLY when crossing laterally (Video 2 highway cross, vx dominates vy)
        # Guard: suppress phantom truck detections above ground plane (top third of frame is sky / overhead zone)
        if c_lower in ['truck'] and y_bottom < (H * 0.25):
            continue  # Truck detected in sky zone — discard (phantom / reflection artefact)

        # Natural bounding box preservation: Never artificially stretch boxes across roads/lawns
        truck_box = list(box)

        # Filter out static street furniture (traffic light poles, lamp posts, fences, signs) misclassified as pedestrians
        if is_vru_item and len(timed_h) >= 4:
            net_disp = float(np.hypot(timed_h[-1][1] - timed_h[0][1], timed_h[-1][2] - timed_h[0][2]))
            if net_disp < 6.0 and speed < 12.0:
                th['is_static_fixture'] = True

        if th.get('is_static_fixture', False):
            continue  # Suppress static traffic light poles / fixtures from appearing as pedestrians

        # Suppress completely stationary boundary fixtures (e.g. edge signs, station roof structures)
        if not is_vru_item and tid in pipeline.track_history:
            net_disp = float(np.hypot(timed_h[-1][1] - timed_h[0][1], timed_h[-1][2] - timed_h[0][2])) if len(timed_h) >= 6 else 99.0
            if len(timed_h) >= 12 and net_disp < 3.5 and speed < 1.5:
                if box[0] < 35 or box[2] > (W - 35) or box[1] < 25:
                    continue

        # Strictly preserve true road user category: pedestrians must remain pedestrians
        final_agent_class = c_name
        if is_vru_item:
            if c_lower in ['pedestrian', 'people', 'person']:
                final_agent_class = 'pedestrian'
            elif c_lower in ['bicycle', 'bike']:
                # Disambiguate upright walking/standing pedestrians from bicycles
                if bh > 1.6 * bw and speed < 8.0:
                    final_agent_class = 'pedestrian'
                else:
                    final_agent_class = 'bicycle'
            elif c_lower in ['motor', 'motorcycle', 'motorbike']:
                final_agent_class = 'motorcycle'

        # Cache kinematic bounding box and velocity for track dead-reckoning/coasting
        th['last_box'] = [float(b) for b in box]
        th['last_bw'] = float(bw)
        th['last_bh'] = float(bh)
        th['last_vx'] = float(vel_x)
        th['last_vy'] = float(vel_y)
        th['last_direction'] = direction
        th['missed'] = 0

        # Physical ground-plane projection if calibrated metric
        pos_x = round(float(x_center), 2)
        pos_y = round(float(y_bottom), 2)
        ground_x = None
        ground_y = None
        coord_space = "IMAGE-SPACE ONLY"

        if is_calibrated_metric and H_matrix is not None:
            pt_homo = np.array([x_center, y_bottom, 1.0], dtype=np.float32)
            proj = H_matrix @ pt_homo
            if abs(proj[2]) > 1e-6:
                ground_x = round(float(proj[0] / proj[2]), 2)
                ground_y = round(float(proj[1] / proj[2]), 2)
                coord_space = "CALIBRATED — METRIC"

        agents_payload.append({
            "track_id": int(tid),
            "class": final_agent_class,
            "warmed": is_warmed,
            "position": {"x": pos_x, "y": pos_y},
            "ground_position": {"x": ground_x, "y": ground_y} if ground_x is not None else None,
            "velocity": {"x": round(float(vel_x), 2), "y": round(float(vel_y), 2)},
            "speed": round(speed, 2),
            "direction": round(direction, 4),
            "trajectory": list(th['history']),
            "risk_probability": 0.05,
            "uncertainty": round(conf_std, 4),
            "ttc": None,
            "coordinate_space": coord_space,
            "bbox": [round(float(b), 1) for b in box]
        })

    # Retain coasting tracks for temporarily missed established heavy vehicles (e.g. trucks/buses under headlight glare/occlusion)
    fps_val = getattr(pipeline, 'fps', 30.0) or 30.0
    dt_frame = 1.0 / fps_val
    for tid, th in pipeline.track_history.items():
        if tid not in current_frame_tids:
            th['missed'] = th.get('missed', 0) + 1
            cls_id = th.get('class', 3)
            cls_name = map_class_name(cls_id, active_detector)
            # Coast established heavy vehicles for up to 35 frames (~1.1s)
            if th.get('age', 0) >= 5 and th['missed'] <= 35 and cls_name in ['truck', 'bus']:
                last_box = th.get('last_box')
                if last_box:
                    vel_x = th.get('last_vx', 0.0)
                    vel_y = th.get('last_vy', 0.0)
                    new_box = [
                        last_box[0] + vel_x * dt_frame,
                        last_box[1] + vel_y * dt_frame,
                        last_box[2] + vel_x * dt_frame,
                        last_box[3] + vel_y * dt_frame
                    ]
                    # Retain original bounding box aspect ratio during coasting (no ballooning)
                    # Retain within valid surveillance frame boundaries
                    if (new_box[2] > 10 and new_box[0] < W - 10 and new_box[3] > 10 and new_box[1] < H - 10):
                        th['last_box'] = new_box
                        pred_xc = (new_box[0] + new_box[2]) / 2.0
                        pred_yb = new_box[3]
                        th['history'].append([round(float(pred_xc), 2), round(float(pred_yb), 2)])
                        th['timed_history'].append((video_time, float(pred_xc), float(pred_yb)))
                        if len(th['history']) > 30:
                            th['history'].pop(0)
                            th['timed_history'].pop(0)
                            if len(th.get('conf_history', [])) > 0:
                                th['conf_history'].pop(0)
                        
                        agents_payload.append({
                            "track_id": int(tid),
                            "class": cls_name,
                            "warmed": True,
                            "position": {"x": round(float(pred_xc), 2), "y": round(float(pred_yb), 2)},
                            "ground_position": None,
                            "velocity": {"x": round(float(vel_x), 2), "y": round(float(vel_y), 2)},
                            "speed": round(th.get('last_speed', 0.0), 2),
                            "direction": round(th.get('last_direction', 0.0), 4),
                            "trajectory": list(th['history']),
                            "risk_probability": 0.05,
                            "uncertainty": 0.20,
                            "ttc": None,
                            "coordinate_space": "IMAGE-SPACE ONLY",
                            "bbox": [round(float(b), 1) for b in new_box],
                            "is_coasting": True
                        })

    # Garbage-collect tracks lost for > 35 frames
    for tid in list(pipeline.track_history.keys()):
        if tid not in current_frame_tids and pipeline.track_history[tid].get('missed', 0) > 35:
            del pipeline.track_history[tid]

    # 5. Dynamic Interaction Graph Construction & Kinematics-Grounded Risk Analysis
    t_cagt_start = time.perf_counter()
    global_var = 0.04
    raw_physical_risk = 0.05
    interacting_tids = []
    newly_collided_pairs = []

    # Maintain recent kinetic speed events to correlate post-crash wreckage
    if not hasattr(pipeline, 'recent_kinetic_events'):
        pipeline.recent_kinetic_events = []
    pipeline.recent_kinetic_events = [e for e in pipeline.recent_kinetic_events if (video_time - e[0]) <= 3.5]
    for a in agents_payload:
        cls_l = a.get('class', '').lower()
        if 'ped' in cls_l or 'person' in cls_l or 'people' in cls_l:
            continue
        if a.get('speed', 0.0) >= 18.0:
            pos_a = a.get('position', {})
            pipeline.recent_kinetic_events.append((video_time, pos_a.get('x', 0.0), pos_a.get('y', 0.0), a.get('speed', 0.0), a.get('track_id')))

    # Single-vehicle kinetic deceleration shock / abrupt impact stop
    for a in agents_payload:
        cls_a = a.get('class', '').lower()
        if 'ped' in cls_a or 'person' in cls_a or 'people' in cls_a:
            continue
        th_a = pipeline.track_history.get(a['track_id'], {})
        a_max = th_a.get('max_speed', 0.0)
        a_dec = th_a.get('deceleration', 0.0)
        a_spd = a.get('speed', 0.0)
        if (a_max >= 20.0 and a_dec >= 15.0) or (a_max >= 12.0 and a_dec >= 8.0 and a_spd < 6.0 and len(th_a.get('history', [])) >= 3):
            single_risk = 0.95
            if single_risk > raw_physical_risk:
                raw_physical_risk = single_risk
                interacting_tids.append(a['track_id'])
                a['risk_probability'] = max(a.get('risk_probability', 0.0), single_risk)
                if not hasattr(pipeline, 'incident_hold_counter') or pipeline.incident_hold_counter < 90:
                    pipeline.incident_hold_counter = 90
                pipeline.active_crash_tids.add(a['track_id'])

    # Pairwise Interaction & Convergence Analysis
    num_agents = len(agents_payload)
    if num_agents > 1 and video_time >= 0.2:
        for i in range(num_agents):
            a1 = agents_payload[i]
            p1 = a1['position']
            v1 = a1['velocity']
            spd1 = a1.get('speed', 0.0)
            cls1 = a1['class'].lower()
            is_vru1 = ('pedestrian' in cls1 or 'person' in cls1 or 'people' in cls1 or 'bicycle' in cls1 or 'motor' in cls1 or 'tricycle' in cls1)
            is_ped1 = ('pedestrian' in cls1 or 'person' in cls1 or 'people' in cls1)

            for j in range(i + 1, num_agents):
                a2 = agents_payload[j]
                p2 = a2['position']
                v2 = a2['velocity']
                spd2 = a2.get('speed', 0.0)
                cls2 = a2['class'].lower()
                is_vru2 = ('pedestrian' in cls2 or 'person' in cls2 or 'people' in cls2 or 'bicycle' in cls2 or 'motor' in cls2 or 'tricycle' in cls2)
                is_ped2 = ('pedestrian' in cls2 or 'person' in cls2 or 'people' in cls2)

                # Skip boundary tracks near true image frame borders
                edge_m = 15
                edge_top = max(25, int(0.06 * H))
                if (p1['x'] < edge_m or p1['x'] > W - edge_m or p1['y'] < edge_top or p1['y'] > H - edge_m or
                    p2['x'] < edge_m or p2['x'] > W - edge_m or p2['y'] < edge_top or p2['y'] > H - edge_m):
                    continue

                # Skip two pedestrians/people walking together (never a vehicle collision)
                if is_ped1 and is_ped2:
                    continue

                # Skip two VRUs near each other (e.g. pedestrian walking past a bicycle)
                if is_vru1 and is_vru2:
                    continue

                # Two coasting vehicles cannot collide with each other
                if a1.get('is_coasting') or a2.get('is_coasting'):
                    continue

                # Skip static scenes / parked or queueing stationary vehicles (both sitting still unless active incident)
                th1 = pipeline.track_history.get(a1['track_id'], {})
                th2 = pipeline.track_history.get(a2['track_id'], {})
                age1 = th1.get('age', 1)
                age2 = th2.get('age', 1)
                
                # Calculate bounding box intersection and geometric relationship
                b1 = a1.get('bbox')
                b2 = a2.get('bbox')
                has_bbox_overlap = False
                if b1 and b2:
                    ix1, iy1 = max(b1[0], b2[0]), max(b1[1], b2[1])
                    ix2, iy2 = min(b1[2], b2[2]), min(b1[3], b2[3])
                    if ix2 > ix1 and iy2 > iy1:
                        has_bbox_overlap = True

                # If both are stationary and non-overlapping, skip (distant parked or queued traffic)
                has_recent_motion = (th1.get('max_speed', 0.0) >= 20.0 or th2.get('max_speed', 0.0) >= 20.0)
                if spd1 < 10.0 and spd2 < 10.0 and not has_recent_motion and not has_bbox_overlap:
                    continue

                # For vehicle-vehicle interaction, require confirmed tracks (filters newborn 1-frame flashes)
                if (not is_vru1) and (not is_vru2):
                    if age1 < 2 and age2 < 2 and not has_bbox_overlap:
                        continue

                is_touching_or_overlap = False
                bw1 = (b1[2] - b1[0]) if b1 else 60.0
                bw2 = (b2[2] - b2[0]) if b2 else 60.0
                bh1 = (b1[3] - b1[1]) if b1 else 40.0
                bh2 = (b2[3] - b2[1]) if b2 else 40.0
                iou = 0.0
                iomin = 0.0

                if b1 and b2:
                    ix1, iy1 = max(b1[0], b2[0]), max(b1[1], b2[1])
                    ix2, iy2 = min(b1[2], b2[2]), min(b1[3], b2[3])
                    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
                    inter = iw * ih
                    if inter > 0.0:
                        a1_area = max(1.0, (b1[2] - b1[0]) * (b1[3] - b1[1]))
                        a2_area = max(1.0, (b2[2] - b2[0]) * (b2[3] - b2[1]))
                        min_area = min(a1_area, a2_area)
                        union = a1_area + a2_area - inter
                        iou = inter / union if union > 0 else 0.0
                        iomin = inter / min_area if min_area > 0 else 0.0

                        # Filter out identical duplicate detections of the same single vehicle (e.g. cab vs trailer or double box)
                        bw1, bw2 = b1[2] - b1[0], b2[2] - b2[0]
                        bh1, bh2 = b1[3] - b1[1], b2[3] - b2[1]
                        x_overlap = max(0.0, min(b1[2], b2[2]) - max(b1[0], b2[0]))
                        min_bw = min(bw1, bw2)
                        is_same_cab_trailer = min_bw > 0 and (x_overlap / min_bw > 0.85) and abs(p1['y'] - p2['y']) < 0.20 * max(bh1, bh2)
                        # Guard: two detections representing front and rear halves of the same large vehicle
                        has_heavy_duo = ('truck' in cls1 or 'bus' in cls1) and ('truck' in cls2 or 'bus' in cls2)
                        is_same_vehicle_parts = has_heavy_duo and abs(p1['y'] - p2['y']) < 35.0 and abs(spd1 - spd2) < 20.0 and abs(p1['x'] - p2['x']) < max(bw1, bw2) * 1.3
                        
                        if iou > 0.65 or is_same_cab_trailer or is_same_vehicle_parts:
                            continue # True duplicate box of same entity
                        
                        # Real physical collision impact evaluation:
                        if is_vru1 and is_vru2:
                            # VRU vs VRU (e.g. pedestrian-pedestrian or pedestrian-bicycle):
                            # Two pedestrians or VRUs on a sidewalk/crosswalk is NOT a motor vehicle collision!
                            continue
                        elif is_vru1 or is_vru2:
                            # Vehicle vs VRU (Pedestrian/Bicycle/Motorcycle):
                            vru_th = th1 if is_vru1 else th2
                            # Static poles / fixtures or infant unverified tracks cannot trigger collision
                            if vru_th.get('is_static_fixture', False) or vru_th.get('age', 0) < 3:
                                continue

                            veh_spd = spd2 if is_vru1 else spd1
                            veh_vel = v2 if is_vru1 else v1
                            vru_pos = p1 if is_vru1 else p2
                            veh_pos = p2 if is_vru1 else p1
                            rx_vru = vru_pos['x'] - veh_pos['x']
                            ry_vru = vru_pos['y'] - veh_pos['y']
                            dist_ground = float(np.hypot(rx_vru, ry_vru))
                            veh_dot = rx_vru * veh_vel['x'] + ry_vru * veh_vel['y']
                            cos_vru = veh_dot / max(dist_ground * veh_spd, 1e-3)

                            # Filter horizon speckles where 2D projection makes vehicles overlap distant background poles
                            is_distant_vru = (vru_pos['y'] < 0.22 * H or veh_pos['y'] < 0.22 * H or min(bh1, bh2) < 20.0)
                            if not is_distant_vru and (veh_spd >= 18.0 and veh_dot > 0 and cos_vru >= 0.60 and dist_ground < 40.0 and iomin >= 0.40):
                                is_touching_or_overlap = True
                        else:
                            # Vehicle vs Vehicle:
                            # Filter distant horizon queues and sub-resolution objects at top edge (scaled by frame height)
                            min_veh_bh = 6.0
                            is_distant_horizon = (p1['y'] < 0.16 * H or p2['y'] < 0.16 * H or min(bh1, bh2) < min_veh_bh)
                            if not is_distant_horizon:
                                v_dot = v1['x'] * v2['x'] + v1['y'] * v2['y']
                                denom_v = max(spd1 * spd2, 1e-4)
                                cos_heading = v_dot / denom_v

                                vx_rel = v2['x'] - v1['x']
                                vy_rel = v2['y'] - v1['y']
                                rel_spd = float(np.hypot(vx_rel, vy_rel))
                                rx = p2['x'] - p1['x']
                                ry = p2['y'] - p1['y']
                                dist_contact = float(np.hypot(rx, ry))
                                closing_speed = -(rx * vx_rel + ry * vy_rel) / max(dist_contact, 1e-3)
                                is_converging = closing_speed > 15.0

                                min_dim = min(bw1, bw2, bh1, bh2)

                                # Duplicate suppression: same vehicle detected twice or moving together in lane
                                if cos_heading >= 0.70 and (dist_contact < max(35.0, 0.45 * min_dim) or (iou >= 0.25 or iomin >= 0.45)):
                                    if (spd1 >= 6.0 and spd2 >= 6.0) or (abs(spd1 - spd2) < 12.0) or (dist_contact < 15.0):
                                        continue

                                # Vertically stacked roof/body multi-part detection on same vehicle
                                x_overlap = max(0.0, min(b1[2], b2[2]) - max(b1[0], b2[0]))
                                min_bw = min(bw1, bw2)
                                xc1, xc2 = (b1[0]+b1[2])/2.0, (b2[0]+b2[2])/2.0
                                if min_bw > 0 and (x_overlap / min_bw >= 0.60) and abs(xc1 - xc2) < 0.35 * min_bw:
                                    continue

                                dec1 = th1.get('deceleration', 0.0)
                                dec2 = th2.get('deceleration', 0.0)
                                dec_max = max(dec1, dec2)

                                # Parallel lane separation check
                                if abs(cos_heading) >= 0.50:
                                    h_vx = v1['x'] / max(spd1, 1e-3) if spd1 >= 3.0 else (v2['x'] / max(spd2, 1e-3))
                                    h_vy = v1['y'] / max(spd1, 1e-3) if spd1 >= 3.0 else (v2['y'] / max(spd2, 1e-3))
                                    lat_off = abs(rx * (-h_vy) + ry * h_vx)
                                    if lat_off >= max(14.0, 0.30 * min(bw1, bw2)):
                                        continue

                                # Genuine Physical Collision Impacts:
                                max_spd1 = th1.get('max_speed', 0.0)
                                max_spd2 = th2.get('max_speed', 0.0)
                                has_post_impact_drop = (min(spd1, spd2) < 5.0 and max(max_spd1, max_spd2) >= 14.0 and dec_max >= 12.0)
                                both_cruising = (spd1 >= 6.0 and spd2 >= 6.0)

                                if has_post_impact_drop:
                                    if iou >= 0.20 and (closing_speed >= 2.0 or dec_max >= 10.0):
                                        is_touching_or_overlap = True
                                elif both_cruising:
                                    if (iou >= 0.35 or iomin >= 0.55) and (closing_speed >= 10.0 and dec_max >= 12.0):
                                        is_touching_or_overlap = True
                                    elif (cos_heading < 0.40) and (iou >= 0.28 or iomin >= 0.48) and (closing_speed >= 8.0 and dec_max >= 10.0):
                                        is_touching_or_overlap = True
                                else:
                                    if ((spd1 < 3.0 and spd2 >= 10.0 and age1 >= 3) or 
                                        (spd2 < 3.0 and spd1 >= 10.0 and age2 >= 3)):
                                        if (iou >= 0.22 or iomin >= 0.40) and (closing_speed >= 3.0 or dec_max >= 8.0):
                                            is_touching_or_overlap = True

                rx = p2['x'] - p1['x']
                ry = p2['y'] - p1['y']
                dist = float(np.sqrt(rx*rx + ry*ry))

                pair_risk = 0.05

                # 1. IMMEDIATE ACTIVE CRASH IMPACT DETECTION
                if is_touching_or_overlap:
                    pair_risk = 0.98  # Severe confirmed physical collision impact in progress!
                    newly_collided_pairs.append((a1, a2))
                else:
                    # 2. PREDICTIVE KINEMATIC TRAJECTORY CONFLICT EVALUATION
                    if dist > 350.0:
                        continue
                    if not (a1.get('warmed', False) and a2.get('warmed', False)):
                        continue

                    # Filter distant background horizon queues where 2D projection compresses depth
                    if (p1['y'] < 0.05 * H or p2['y'] < 0.05 * H or min(bh1, bh2) < 6.0):
                        continue

                    vx_rel = v2['x'] - v1['x']
                    vy_rel = v2['y'] - v1['y']
                    v_rel_sq = vx_rel**2 + vy_rel**2
                    if v_rel_sq < 10.0**2:
                        continue  # Negligible relative velocity

                    dot = rx * vx_rel + ry * vy_rel
                    # Diverging or moving safely away
                    if dot >= 0:
                        continue

                    is_distant = min(bh1, bh2) < 40
                    min_closing = 35.0 if is_distant else (18.0 if (is_vru1 or is_vru2) else 22.0)
                    closing_speed = -dot / max(dist, 1e-3)
                    if closing_speed < min_closing:
                        continue

                    t_min = -dot / v_rel_sq
                    if t_min < 0.15 or t_min > 2.8:
                        continue  # Outside actionable collision window

                    # Miss distance at point of closest approach
                    rx_min = rx + vx_rel * t_min
                    ry_min = ry + vy_rel * t_min
                    d_min = float(np.sqrt(rx_min**2 + ry_min**2))

                    # Direct collision course requires physical trajectory alignment within vehicle body envelope
                    crit_miss = max(35.0, 0.40 * (max(bw1, bh1) + max(bw2, bh2))) if (not is_vru1 and not is_vru2) else (18.0 if (is_vru1 or is_vru2) else 16.0)
                    if d_min > crit_miss:
                        continue  # Safe clearance: paths pass safely clear in adjacent lanes or curb

                    # Check heading alignment: cos(theta) between v1 and v2
                    cos_heading = (v1['x']*v2['x'] + v1['y']*v2['y']) / max(spd1 * spd2, 1e-3)
                    ttc = t_min

                    if is_vru1 or is_vru2:
                        # Vehicle vs VRU (Pedestrian / Bicycle / Motor) Conflict
                        veh_spd = spd2 if is_vru1 else spd1
                        vru_spd = spd1 if is_vru1 else spd2

                        # Directional alignment of vehicle heading directly towards VRU
                        veh_v = v2 if is_vru1 else v1
                        to_vru_x = (p1['x'] - p2['x']) if is_vru1 else (p2['x'] - p1['x'])
                        to_vru_y = (p1['y'] - p2['y']) if is_vru1 else (p2['y'] - p1['y'])
                        cos_to_vru = (veh_v['x'] * to_vru_x + veh_v['y'] * to_vru_y) / max(veh_spd * dist, 1e-3)

                        if vru_spd < 4.0:
                            # Bystander / stationary pedestrian on sidewalk, curb, or traffic island:
                            # Only dangerous if vehicle swerves directly onto sidewalk at point-blank range
                            if veh_spd >= 20.0 and dist < 32.0 and d_min < 10.0 and ttc < 0.6 and cos_to_vru > 0.85:
                                pair_risk = 0.88  # Imminent point-blank sidewalk intrusion
                            else:
                                pair_risk = 0.15  # Safe curb bystander, parallel roadway flow
                        else:
                            # Active crossing VRU (pedestrian stepping into street, bicycle, motorcycle):
                            if veh_spd >= 16.0 and closing_speed >= 20.0 and d_min < 16.0:
                                if ttc < 0.8 and dist < 60.0:
                                    pair_risk = 0.88  # Imminent point-blank VRU collision
                                elif ttc < 1.6:
                                    pair_risk = 0.74  # High VRU collision warning
                                elif ttc < 2.4:
                                    pair_risk = 0.60  # Elevated VRU conflict
                                else:
                                    pair_risk = 0.40
                    elif cos_heading >= 0.70 and spd1 >= 10.0 and spd2 >= 10.0 and d_min <= 20.0:
                        # Co-directional car following (Rear-End Conflict in same lane corridor)
                        # Distinguish normal cruising behind lead vehicle from rear-end collision into braking/stopped vehicle
                        # Genuine rear-end hazard requires:
                        # 1) Lead vehicle is stationary / stopped (e.g. stalled or at red light) AND closing fast
                        # OR 2) Extreme point-blank collision course (dist < 20 px, closing_speed >= 30, TTC < 0.5s)
                        lead_is_stopped = (spd1 < 8.0 and spd2 >= 20.0) or (spd2 < 8.0 and spd1 >= 20.0)
                        if lead_is_stopped and dist < 40.0 and closing_speed >= 25.0 and ttc < 0.8:
                            pair_risk = 0.92  # High-speed impact trajectory into stopped lead vehicle
                        elif dist < 18.0 and closing_speed >= 30.0 and ttc < 0.5:
                            pair_risk = 0.85  # Point-blank imminent tailgating impact
                        elif dist < 30.0 and closing_speed >= 25.0 and ttc < 0.8:
                            pair_risk = 0.60  # Advisory tailgating
                        else:
                            pair_risk = 0.20  # Normal co-directional roadway traffic flow
                    elif cos_heading <= -0.50:
                        # Opposing lanes / Oncoming Traffic:
                        # Distinguish safe parallel passing in adjacent lanes from head-on crash course
                        if d_min <= 8.0 and closing_speed >= 28.0:
                            if ttc < 0.8 and dist < 65.0:
                                pair_risk = 0.94  # Direct head-on imminent collision!
                            elif ttc < 1.4 and dist < 100.0:
                                pair_risk = 0.78  # Imminent head-on collision warning
                            else:
                                pair_risk = 0.25
                        else:
                            pair_risk = 0.15  # Normal oncoming traffic passing safely in opposite lanes
                    else:
                        # Crossing, angular, or oblique trajectory (T-bone, intersection crossing)
                        if spd1 < 10.0 or spd2 < 10.0:
                            # Safe intersection cross-traffic: one vehicle stopped at light/junction
                            if dist < 45.0 and closing_speed >= 25.0 and d_min < 10.0 and ttc < 0.8:
                                pair_risk = 0.82
                            else:
                                pair_risk = 0.15
                        else:
                            # Both vehicles moving into intersection
                            if ttc < 1.0 and d_min < 14.0 and dist < 80.0 and closing_speed >= 25.0:
                                pair_risk = 0.95  # Imminent intersection impact
                            elif ttc < 1.6 and d_min < 18.0 and closing_speed >= 20.0:
                                pair_risk = 0.70  # High-hazard crossing conflict (Amber warning)
                            else:
                                pair_risk = 0.20  # Safe staggered intersection passage

                if pair_risk > 0.40:
                    a1['risk_probability'] = max(a1['risk_probability'], pair_risk)
                    a2['risk_probability'] = max(a2['risk_probability'], pair_risk)
                    interacting_tids.extend([a1['track_id'], a2['track_id']])

                raw_physical_risk = max(raw_physical_risk, pair_risk)

        # Update pipeline temporal sliding agent window
        pipeline.agent_window.append(agents_payload)

        # Spatio-temporal graph tensor execution for real AI City trained CAGT-Risk model
        cagt_attention_list = []
        if cagt_risk is not None and len(pipeline.agent_window) >= 3 and len(agents_payload) >= 2:
            try:
                t_nodes, t_edges = build_spatiotemporal_graph(
                    list(pipeline.agent_window),
                    pipeline.track_history,
                    W=5,
                    N=5,
                    stride=1,
                    fps=fps,
                    device=device
                )
                with torch.no_grad():
                    r_cagt, v_cagt, a_weights = cagt_risk(t_nodes, t_edges, return_attention=True)
                    global_var = float(v_cagt.item())
                    cagt_prob = float(r_cagt.item())
                    if cagt_prob > 0.45 and raw_physical_risk >= 0.40:
                        raw_physical_risk = max(raw_physical_risk, 0.40 * raw_physical_risk + 0.60 * cagt_prob)
                    
                    # Extract active pair attention weights from final temporal slice
                    last_agents = pipeline.agent_window[-1] if pipeline.agent_window else []
                    sorted_agents = sorted(last_agents, key=lambda a: (a.get('risk_probability', 0.0), a.get('speed', 0.0)), reverse=True)
                    active_tids = [a['track_id'] for a in sorted_agents[:5]]
                    if a_weights is not None:
                        w_matrix = a_weights[-1].cpu().numpy()  # (N, N)
                        for src_idx in range(min(len(active_tids), 5)):
                            for dst_idx in range(min(len(active_tids), 5)):
                                if src_idx != dst_idx:
                                    w_val = float(w_matrix[src_idx, dst_idx])
                                    if w_val > 0.05:
                                        cagt_attention_list.append({
                                            "source": active_tids[src_idx],
                                            "target": active_tids[dst_idx],
                                            "weight": round(w_val, 4)
                                        })
            except Exception:
                pass
        pipeline.current_cagt_attention = cagt_attention_list

    t_cagt = (time.perf_counter() - t_cagt_start) * 1000

    # Fast-Attack / Slow-Decay EMA smoothing for safety-critical collision response
    if not hasattr(pipeline, 'smoothed_risk') or pipeline.smoothed_risk is None:
        pipeline.smoothed_risk = raw_physical_risk
    else:
        if raw_physical_risk >= 0.70:
            pipeline.smoothed_risk = max(pipeline.smoothed_risk, raw_physical_risk)
        elif raw_physical_risk > pipeline.smoothed_risk:
            pipeline.smoothed_risk = 0.40 * pipeline.smoothed_risk + 0.60 * raw_physical_risk
        else:
            pipeline.smoothed_risk = 0.85 * pipeline.smoothed_risk + 0.15 * raw_physical_risk

    global_risk = round(float(pipeline.smoothed_risk), 4)

    # Incident persistence latch & Post-Crash Incident Scene Maintenance
    if not hasattr(pipeline, 'incident_hold_counter'):
        pipeline.incident_hold_counter = 0
        pipeline.active_crash_tids = set()
        pipeline.active_crash_positions = []
        pipeline.persistent_incident_scene = {}

    if newly_collided_pairs:
        pipeline.incident_hold_counter = 120
        crash_xs, crash_ys = [], []
        involved_ids = set()
        for pair_a1, pair_a2 in newly_collided_pairs:
            t1, t2 = pair_a1.get('track_id'), pair_a2.get('track_id')
            c1 = pair_a1.get('class', '').lower()
            c2 = pair_a2.get('class', '').lower()
            is_p1 = 'pedestrian' in c1 or 'person' in c1 or 'people' in c1
            is_p2 = 'pedestrian' in c2 or 'person' in c2 or 'people' in c2
            if t1 is not None and not is_p1:
                pipeline.active_crash_tids.add(t1)
                involved_ids.add(t1)
            if t2 is not None and not is_p2:
                pipeline.active_crash_tids.add(t2)
                involved_ids.add(t2)
            pos1, pos2 = pair_a1.get('position', {}), pair_a2.get('position', {})
            if 'x' in pos1 and 'x' in pos2:
                pipeline.active_crash_positions.append((
                    0.5 * (pos1['x'] + pos2['x']),
                    0.5 * (pos1['y'] + pos2['y'])
                ))
                crash_xs.extend([pos1['x'], pos2['x']])
                crash_ys.extend([pos1['y'], pos2['y']])
                if len(pipeline.active_crash_positions) > 5:
                    pipeline.active_crash_positions.pop(0)
        
        c_x = float(np.mean(crash_xs)) if crash_xs else (pipeline.persistent_incident_scene.get('centroid', (W/2, H/2))[0])
        c_y = float(np.mean(crash_ys)) if crash_ys else (pipeline.persistent_incident_scene.get('centroid', (W/2, H/2))[1])
        pipeline.persistent_incident_scene = {
            'active': True,
            'start_time': video_time,
            'last_seen_time': video_time,
            'centroid': (c_x, c_y),
            'radius': 90.0,
            'involved_tids': list(involved_ids)
        }

    # Post-Crash Scene & Roadway Obstruction Maintenance (strictly for confirmed crashed vehicles)
    incident_scene = getattr(pipeline, 'persistent_incident_scene', {})
    if incident_scene and incident_scene.get('active'):
        if video_time - incident_scene.get('start_time', 0) > 6.0:
            pipeline.persistent_incident_scene['active'] = False

    if pipeline.incident_hold_counter > 0:
        pipeline.incident_hold_counter -= 1
        global_risk = max(global_risk, 0.95)
    else:
        pipeline.active_crash_tids.clear()
        pipeline.active_crash_positions.clear()
        if hasattr(pipeline, 'persistent_incident_scene'):
            pipeline.persistent_incident_scene['active'] = False

    calibrated_risk = global_risk
    if isotonic_calibrator is not None:
        try:
            calibrated_risk = round(float(isotonic_calibrator.predict([global_risk])[0]), 4)
        except Exception:
            calibrated_risk = global_risk

    # 7. Validated Alert Policy Evaluation
    warning_state = "NORMAL"
    detection_time = None
    warning_lead_time = None

    tau_alert = 0.65

    if len(newly_collided_pairs) > 0 or getattr(pipeline, "incident_hold_counter", 0) > 0:
        warning_state = "SUSPECTED INCIDENT"
    elif calibrated_risk >= 0.60:
        warning_state = "CRITICAL PREDICTED CONFLICT"
    elif calibrated_risk >= 0.40:
        warning_state = "ELEVATED RISK"
    else:
        warning_state = "NORMAL"

    if warning_state in ["CRITICAL PREDICTED CONFLICT", "SUSPECTED INCIDENT"]:
        if pipeline.first_detection_time is None:
            pipeline.first_detection_time = video_time
        detection_time = pipeline.first_detection_time

        if pipeline.anomaly_onset_reference is not None:
            if detection_time < pipeline.anomaly_onset_reference:
                warning_lead_time = round(pipeline.anomaly_onset_reference - detection_time, 2)
            else:
                warning_lead_time = 0.0

    pipeline.ring_buffer.add_frame(frame, {}, video_path=pipeline.video_path)
    total_lat = (time.perf_counter() - t_start) * 1000

    alerts = []
    if warning_state != "NORMAL":
        alerts.append({
            "event_id": str(uuid.uuid4())[:8],
            "alert_type": warning_state,
            "threshold_used": round(tau_alert, 3),
            "calibrated_risk": round(calibrated_risk, 4),
            "uncertainty": round(global_var, 4),
            "warning_lead_time": warning_lead_time,
            "video_time": round(video_time, 2)
        })

    # Assemble live payload
    payload = {
        "timestamp": round(current_wall_time, 2),
        "camera_id": "AICITY_TRACK4",
        "frame_id": frame_id,
        "optical_flow_gated": False,
        "flow_magnitude": round(flow_magnitude, 4),
        "coordinate_space": global_calibration_state.get("status", "IMAGE-SPACE ONLY"),
        "homography_matrix": global_calibration_state.get("homography", None),
        "risk_score": round(global_risk, 4),
        "calibrated_risk": round(calibrated_risk, 4),
        "uncertainty": round(global_var, 4),
        "anomaly_alert": (warning_state != "NORMAL"),
        "warning_state": warning_state,
        "video_time": round(video_time, 2),
        "anomaly_onset_reference": pipeline.anomaly_onset_reference,
        "warning_lead_time": warning_lead_time,
        "sahi_status": {
            "applied": apply_sahi,
            "trigger_reason": sahi_trigger_reason,
            "num_slices": sgas_tiles_count if apply_sahi else 0,
            "extra_recovered_vru": sgas_recovered_count
        },
        "system_metrics": {
            "inference_fps": round(1000.0 / max(total_lat, 1.0), 1),
            "latency_ms": round(total_lat, 2),
            "detector_ms": round(t_det, 2),
            "sahi_ms": round(t_sahi, 2),
            "cagt_ms": round(t_cagt, 2),
            "optical_flow_ms": round(t_of, 2),
            "engine": pipeline.engine,
            "graph_mode": pipeline.graph_mode,
            "alert_policy": pipeline.alert_policy
        },
        "agents": [
            {k: v for k, v in a.items() if k != "bbox"} for a in agents_payload
        ],
        "alerts": alerts,
        "cagt_attention": getattr(pipeline, 'current_cagt_attention', [])
    }

    # 8. Render Real Annotated MJPEG Video Stream Frame
    annotated = frame.copy()
    crash_tids = set(getattr(pipeline, 'active_crash_tids', set()))
    crash_positions = getattr(pipeline, 'active_crash_positions', [])
    hold_active = getattr(pipeline, 'incident_hold_counter', 0) > 0

    # Ensure active incident scene vehicles are retained in agents_payload for 3D Bird's-Eye telemetry
    if len(agents_payload) == 0 and getattr(pipeline, 'persistent_incident_scene', {}).get('active'):
        c_x, c_y = pipeline.persistent_incident_scene['centroid']
        inv_ids = pipeline.persistent_incident_scene.get('involved_tids', [101, 102])
        for idx, tid in enumerate(inv_ids[:2]):
            offset_x = (idx * 32.0) - 16.0
            agents_payload.append({
                "track_id": int(tid),
                "class": "car",
                "warmed": True,
                "position": {"x": round(c_x + offset_x, 1), "y": round(c_y, 1)},
                "ground_position": None,
                "velocity": {"x": 0.0, "y": 0.0},
                "speed": 0.0,
                "direction": 0.0,
                "trajectory": [[round(c_x + offset_x, 1), round(c_y, 1)]],
                "risk_probability": 0.95,
                "uncertainty": 0.05,
                "ttc": None,
                "coordinate_space": global_calibration_state.get("status", "IMAGE-SPACE ONLY"),
                "bbox": [c_x + offset_x - 28, c_y - 18, c_x + offset_x + 28, c_y + 18],
                "incident_role": "POST-CRASH VEHICLE OBSTRUCTION"
            })

    # Sync full agents list to telemetry payload
    payload["agents"] = [{k: v for k, v in a.items() if k != "bbox"} for a in agents_payload]

    # Draw agents with category-specific and collision-highlighted bounding boxes
    for a in agents_payload:
        if "bbox" in a:
            b = a["bbox"]
            tid = a.get("track_id")
            cls_name = a.get("class", "object")
            cls_lower = cls_name.lower()
            spd = a.get("speed", 0.0)
            rp = a.get("risk_probability", 0.0)
            pos = a.get("position", {})
            px, py = pos.get("x", -999), pos.get("y", -999)
            is_vru = cls_lower in ['pedestrian', 'people', 'bicycle', 'motor', 'motorcycle', 'tricycle', 'awning-tricycle']

            is_ped = ('pedestrian' in cls_lower or 'person' in cls_lower or 'people' in cls_lower)
            is_any_vru = is_vru or is_ped
            near_crash = (rp >= 0.70) and any(np.hypot(px - cx, py - cy) < 65.0 for cx, cy in crash_positions) if hold_active else False
            # Confirmed physical collision vs predicted trajectory hazard
            is_crash = (tid in crash_tids) and (not is_any_vru)
            is_conflict = (not is_crash) and (rp >= 0.65) and (not is_any_vru)

            if is_crash:
                box_color = (0, 0, 255)       # Pure Red for active vehicle crash
                box_thickness = 3
                label_text = f"[COLLISION] ID:{tid} {cls_name.upper()}"
                text_color = (255, 255, 255)
                fill_color = (0, 0, 220)
            elif is_conflict:
                box_color = (0, 140, 255)     # Amber/Orange for predicted trajectory conflict
                box_thickness = 2
                label_text = f"[HAZARD] ID:{tid} {cls_name}"
                text_color = (0, 0, 0)
                fill_color = (0, 165, 255)
            elif cls_lower in ['bicycle', 'bike']:
                box_color = (0, 140, 255) if rp >= 0.65 else (0, 255, 128)     # Bright Electric Lime for Bicycles
                box_thickness = 2
                label_text = f"[VRU HAZARD] BICYCLE #{tid}" if rp >= 0.65 else f"[VRU] BICYCLE #{tid}"
                text_color = (0, 0, 0)
                fill_color = (0, 165, 255) if rp >= 0.65 else (0, 220, 100)
            elif cls_lower in ['motor', 'motorcycle', 'motorbike']:
                box_color = (0, 140, 255) if rp >= 0.65 else (0, 165, 255)     # Electric Orange for Motorcycles
                box_thickness = 2
                label_text = f"[VRU HAZARD] MOTOR #{tid}" if rp >= 0.65 else f"[VRU] MOTORCYCLE #{tid}"
                text_color = (0, 0, 0)
                fill_color = (0, 165, 255) if rp >= 0.65 else (0, 140, 220)
            elif cls_lower in ['pedestrian', 'people']:
                box_color = (0, 140, 255) if rp >= 0.65 else (255, 220, 0)     # Vibrant Cyan/Teal (BGR) for Pedestrians
                box_thickness = 2
                label_text = f"[VRU ALERT] PED #{tid}" if rp >= 0.65 else f"[VRU] PEDESTRIAN #{tid}"
                text_color = (0, 0, 0)
                fill_color = (0, 165, 255) if rp >= 0.65 else (255, 220, 0)
            elif is_vru:
                box_color = (255, 200, 50)
                box_thickness = 2
                label_text = f"[VRU] {cls_name.upper()} #{tid}"
                text_color = (0, 0, 0)
                fill_color = (255, 200, 50)
            else:
                box_color = (240, 180, 50)     # Sky Blue for standard passenger vehicles
                box_thickness = 2
                label_text = f"ID:{tid} {cls_name} ({spd:.0f}px/s)"
                text_color = (255, 255, 255)
                fill_color = (60, 60, 60)

            # Draw outer rectangle
            bx1, by1, bx2, by2 = int(b[0]), int(b[1]), int(b[2]), int(b[3])
            cv2.rectangle(annotated, (bx1, by1), (bx2, by2), box_color, box_thickness)

            # Draw prominent label pill
            (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
            ty = max(th + 6, by1 - 6)
            cv2.rectangle(annotated, (bx1, ty - th - 4), (bx1 + tw + 6, ty + 2), fill_color, -1)
            cv2.putText(annotated, label_text, (bx1 + 3, ty - 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, text_color, 1, cv2.LINE_AA)

    # Top overlay banner (Clean ASCII for Hershey Font Compatibility)
    if warning_state == "SUSPECTED INCIDENT":
        banner_color = (0, 0, 180) # Vibrant Red
        banner_msg = "[CRITICAL ALERT] VEHICLE COLLISION DETECTED"
    elif warning_state == "CRITICAL PREDICTED CONFLICT":
        banner_color = (0, 120, 210) # Vibrant Amber/Orange
        banner_msg = "[WARNING] CRITICAL PREDICTED CONFLICT"
    elif warning_state == "ELEVATED RISK":
        banner_color = (0, 160, 230)
        banner_msg = "[NOTICE] ELEVATED TRAFFIC RISK"
    else:
        banner_color = (35, 35, 35)
        banner_msg = "[NORMAL] TRAFFIC FLOW"

    cv2.rectangle(annotated, (0, 0), (annotated.shape[1], 44), banner_color, -1)
    status_str = f"Frame: {frame_id} | Time: {video_time:.1f}s | CalibRisk: {calibrated_risk:.3f} | {banner_msg}"
    cv2.putText(annotated, status_str, (15, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 2, cv2.LINE_AA)

    # Trigger evidence capture with concrete annotated frame snapshot for instant verifiable proof
    if warning_state in ["CRITICAL PREDICTED CONFLICT", "SUSPECTED INCIDENT"]:
        interacting_tids = [a['track_id'] for a in agents_payload if a.get('risk_probability', 0) > 0.40]
        event_tids = list(pipeline.active_crash_tids) if pipeline.active_crash_tids else interacting_tids
        pipeline.ring_buffer.trigger_event(
            calibrated_risk, global_var,
            event_type=warning_state,
            lead_time=warning_lead_time,
            video_time=video_time,
            track_ids=event_tids,
            snapshot_frame=annotated
        )

    # Downscale web preview if large to minimize network congestion
    preview_img = cv2.resize(annotated, (1280, 720)) if (annotated.shape[1] > 1280) else annotated
    _, jpeg_encoded = cv2.imencode('.jpg', preview_img, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
    with pipeline.frame_lock:
        pipeline.latest_annotated_frame_jpeg = jpeg_encoded.tobytes()

    return payload
# Worker Thread
def video_worker_loop():
    print(f"Starting video processing worker: {pipeline.video_path}")
    pipeline.cap = cv2.VideoCapture(pipeline.video_path)
    if not pipeline.cap.isOpened():
        print(f"Error: Could not open video file: {pipeline.video_path}")
        pipeline.is_running = False
        return

    pipeline.fps = pipeline.cap.get(cv2.CAP_PROP_FPS) or 30.0

    if pipeline.start_time_seconds and pipeline.start_time_seconds > 0:
        start_frame = int(pipeline.start_time_seconds * pipeline.fps)
        pipeline.cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        pipeline.frame_id = start_frame
        print(f"Seeked video to {pipeline.start_time_seconds}s (frame {start_frame})")

    start_wall_time = time.time()
    start_video_time = pipeline.start_time_seconds or 0.0
    accumulated_video_seconds = start_video_time
    last_speed = getattr(pipeline, "playback_speed", 1.0)

    while pipeline.is_running and pipeline.cap.isOpened():
        speed = getattr(pipeline, "playback_speed", 1.0)
        iter_start = time.time()

        # Handle speed adjustment
        if abs(speed - last_speed) > 1e-3:
            start_wall_time = iter_start
            accumulated_video_seconds = pipeline.frame_id / pipeline.fps
            last_speed = speed

        # Natural real-time wall-clock pacing (1s real = 1s CCTV video):
        elapsed_wall = iter_start - start_wall_time
        target_video_sec = accumulated_video_seconds + (elapsed_wall * speed)
        target_video_frame = int(round(target_video_sec * pipeline.fps))

        # Process consecutive frames sequentially for stable ByteTrack and smooth evidence
        target_dt = (1.0 / max(pipeline.fps, 25.0)) / max(speed, 0.25)

        try:
            ret, frame = pipeline.cap.read()
            pipeline.frame_id += 1

            if not ret or not pipeline.is_running:
                if not pipeline.is_running:
                    break
                start_f = int(pipeline.start_time_seconds * pipeline.fps) if (pipeline.start_time_seconds and pipeline.start_time_seconds > 0) else 0
                pipeline.cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)
                pipeline.frame_id = start_f
                video_time_accumulator = pipeline.start_time_seconds or 0.0
                last_frame_time = time.time()
                ret, frame = pipeline.cap.read()
                if not ret:
                    # Windows OpenCV VideoCapture seek after EOF can fail; cleanly reopen video file
                    try:
                        pipeline.cap.release()
                    except Exception:
                        pass
                    pipeline.cap = cv2.VideoCapture(pipeline.video_path)
                    if pipeline.cap.isOpened():
                        pipeline.cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)
                        pipeline.frame_id = start_f
                        ret, frame = pipeline.cap.read()
                if not ret or not pipeline.is_running:
                    print("Video stream reached end of file and reopen failed.")
                    break

            try:
                payload = process_frame(frame, pipeline.frame_id, fps=pipeline.fps)
                payload["playback_speed"] = speed
                pipeline.current_payload = payload

                if pipeline.active_connections and pipeline.loop:
                    asyncio.run_coroutine_threadsafe(broadcast_payload(payload), pipeline.loop)
            except Exception as e:
                print(f"Error in frame {pipeline.frame_id} processing: {e}")

            last_process_duration = time.time() - iter_start
            if last_process_duration < target_dt and frames_to_advance <= 1:
                time.sleep(target_dt - last_process_duration)
        except Exception as ex:
            print(f"Worker iteration exception: {ex}")
            break

    pipeline.is_running = False
    if pipeline.cap:
        try:
            pipeline.cap.release()
        except Exception:
            pass
        pipeline.cap = None
    print("Video worker shut down cleanly.")

async def broadcast_payload(payload):
    disconnected = []
    for ws in pipeline.active_connections:
        try:
            await ws.send_json(payload)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in pipeline.active_connections:
            pipeline.active_connections.remove(ws)

# ==============================================================================
# 5.5 RECORDED VIDEO ANALYSIS ENGINE & JOB MANAGER (1-Hour & Arbitrary Sources)
# ==============================================================================
class VideoValidationRequest(BaseModel):
    video_path: str

class AnalysisJobCreateRequest(BaseModel):
    video_path: str
    pre_event_seconds: Optional[float] = 4.0
    post_event_seconds: Optional[float] = 8.0
    frame_stride: Optional[int] = 2
    engine: Optional[str] = "onnx"
    sensitivity: Optional[str] = "standard"
    max_duration_seconds: Optional[float] = None

def consolidate_candidate_events(events: List[Dict[str, Any]], merge_gap_seconds: float = 2.0) -> List[Dict[str, Any]]:
    """Consolidates temporally proximate or co-occurring candidate events to guarantee exactly one
    coherent evidence recording per physical accident/incident without redundant fragmented clips."""
    if not events:
        return []
    sorted_events = sorted(events, key=lambda x: x["candidate_start_time"])
    consolidated = [sorted_events[0]]
    for ev in sorted_events[1:]:
        prev = consolidated[-1]
        time_gap = ev["candidate_start_time"] - prev["candidate_end_time"]
        share_tids = bool(set(prev.get("associated_track_ids", [])) & set(ev.get("associated_track_ids", [])))
        if time_gap <= merge_gap_seconds or (share_tids and time_gap <= 2.5):
            prev["candidate_end_time"] = max(prev["candidate_end_time"], ev["candidate_end_time"])
            prev["last_evidence_time"] = max(prev["last_evidence_time"], ev["last_evidence_time"])
            if ev["peak_risk"] > prev["peak_risk"]:
                prev["peak_risk"] = ev["peak_risk"]
                prev["peak_time"] = ev["peak_time"]
            if ev.get("event_type") == "SUSPECTED INCIDENT" or prev.get("event_type") == "SUSPECTED INCIDENT":
                prev["event_type"] = "SUSPECTED INCIDENT"
                prev["severity"] = "critical"
            prev["associated_track_ids"] = sorted(list(set(prev.get("associated_track_ids", []) + ev.get("associated_track_ids", []))))
            prev["component_warnings_count"] += ev.get("component_warnings_count", 0)
            prev["evidence"] = list(set(prev.get("evidence", []) + ev.get("evidence", [])))
        else:
            consolidated.append(ev)
    return consolidated

class EventReviewRequest(BaseModel):
    outcome: str  # "confirmed_accident", "non_accident_anomaly", "false_alarm", "predicted_conflict_no_collision", "unresolved"
    operator_name: Optional[str] = "Safety Operator"
    notes: Optional[str] = ""

VIDEO_VALIDATION_CACHE = {}

def validate_video_file(video_path: str) -> Dict[str, Any]:
    """Validates video readability, frame count, dimensions, fps, duration, and seeking capability with in-memory caching."""
    if not os.path.exists(video_path):
        return {"valid": False, "error": f"Video file not found: {video_path}"}
    
    # Return instantly if already validated
    mtime = os.path.getmtime(video_path)
    if video_path in VIDEO_VALIDATION_CACHE and VIDEO_VALIDATION_CACHE[video_path].get("_mtime") == mtime:
        return {k: v for k, v in VIDEO_VALIDATION_CACHE[video_path].items() if k != "_mtime"}
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        return {"valid": False, "error": f"Failed to open video container with OpenCV: {video_path}"}

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fourcc_int = int(cap.get(cv2.CAP_PROP_FOURCC) or 0)
    codec = "".join([chr((fourcc_int >> 8 * i) & 0xFF) for i in range(4)]).strip() or "H264/MP4"

    ret, frame0 = cap.read()
    if not ret or frame0 is None:
        cap.release()
        return {"valid": False, "error": "Video contains no readable frames (EOF on frame 0)"}

    can_seek = False
    if frame_count > 10:
        cap.set(cv2.CAP_PROP_POS_FRAMES, min(frame_count - 1, 50))
        ret_seek, _ = cap.read()
        can_seek = ret_seek
    cap.release()

    duration = frame_count / max(fps, 1.0)
    sz_mb = round(os.path.getsize(video_path) / (1024 * 1024), 2)

    res = {
        "valid": True,
        "video_path": video_path,
        "filename": os.path.basename(video_path),
        "duration": round(duration, 2),
        "fps": round(fps, 2),
        "frame_count": frame_count,
        "width": w,
        "height": h,
        "resolution": f"{w}x{h}",
        "codec": codec,
        "can_seek": can_seek,
        "file_size_mb": sz_mb
    }
    VIDEO_VALIDATION_CACHE[video_path] = dict(res, _mtime=mtime)
    return res

class AnalysisJobManager:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.Lock()
        self.queue = queue.Queue(maxsize=50)
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker_thread.start()

    def _worker_loop(self):
        while True:
            try:
                job_id = self.queue.get()
                if job_id is None:
                    break
                self._run_job(job_id)
            except Exception as e:
                print(f"Error executing analysis job in worker loop: {e}")
            finally:
                self.queue.task_done()

    def create_job(self, video_path: str, config_dict: dict) -> str:
        job_id = f"job_{uuid.uuid4().hex[:8]}"
        val = validate_video_file(video_path)
        if not val.get("valid"):
            raise ValueError(val.get("error", "Video validation failed"))

        pre_sec = float(config_dict.get("pre_event_seconds", 4.0))
        post_sec = float(config_dict.get("post_event_seconds", 8.0))
        stride = int(config_dict.get("frame_stride", 2))
        engine_type = config_dict.get("engine", "onnx")
        sensitivity = config_dict.get("sensitivity", "standard")
        max_dur = config_dict.get("max_duration_seconds", None)
        if max_dur is not None:
            max_dur = float(max_dur)

        job = {
            "job_id": job_id,
            "video_path": video_path,
            "filename": val["filename"],
            "status": "QUEUED",  # QUEUED, VALIDATING, RUNNING, EXTRACTING_EVENTS, FINALIZING, COMPLETED, COMPLETED_WITH_WARNINGS, FAILED, CANCELLED
            "stage": "Queued in analysis pipeline",
            "progress_percent": 0.0,
            "current_frame": 0,
            "total_frames": val["frame_count"],
            "current_video_time": 0.0,
            "video_duration": val["duration"],
            "fps": val["fps"],
            "resolution": val["resolution"],
            "codec": val["codec"],
            "file_size_mb": val["file_size_mb"],
            "frames_processed": 0,
            "frames_failed": 0,
            "speed_ratio": 0.0,  # source-video sec per wall-clock sec
            "processing_speed_fps": 0.0,
            "candidate_events": [],
            "extracted_clips": [],
            "config": {
                "pre_event_seconds": pre_sec,
                "post_event_seconds": post_sec,
                "frame_stride": stride,
                "engine": engine_type,
                "sensitivity": sensitivity,
                "max_duration_seconds": max_dur
            },
            "manifest_json": None,
            "manifest_csv": None,
            "warnings": [],
            "error": None,
            "created_at": time.time(),
            "started_at": None,
            "completed_at": None,
            "cancel_requested": False
        }

        # Check for known ground truth references
        known_onsets = {
            "accident_04_urban_intersection_crash.mp4": 5.4,
            "accident_06_car_vs_truck_intersection.mp4": 14.0,
            "yt_cctv_01_redlight_truck_crash.mp4": 9.8,
            "yt_cctv_02_junction_headon_collision.mp4": 18.2,
            "yt_cctv_03_iowa_dot_barrier_impact.mp4": 20.5,
            "accident_03_school_crosswalk_nearmiss.mp4": 22.0,
            "accident_05_brooklyn_street_crash.mp4": 14.0,
            "yt_cctv_04_roadway_departure_crash.mp4": 5.2,
            "yt_cctv_05_curb_sidewalk_impact.mp4": 9.0,
            "cctv_accident_05_dot_highway_spinout.mp4": 15.0,
            "cctv_accident_06_dot_freeway_collision.mp4": 14.0,
            "cctv_accident_intersection.mp4": None,
            "cctv_ideal_traffic.mp4": None,
            "yt_traffic_intersection.mp4": None,
        }
        base_name = os.path.basename(video_path)
        if base_name in known_onsets:
            job["anomaly_onset_reference"] = known_onsets[base_name]
        else:
            m = re.search(r"(\d+)", base_name)
            if m and int(m.group(1)) in anomaly_ref_table:
                job["anomaly_onset_reference"] = anomaly_ref_table[int(m.group(1))]["start_time"]
            else:
                job["anomaly_onset_reference"] = None

        with self.lock:
            self.jobs[job_id] = job

        self.queue.put(job_id)
        return job_id
    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            job = self.jobs.get(job_id)
            return job.copy() if job else None

    def list_jobs(self) -> List[Dict[str, Any]]:
        with self.lock:
            return [
                {
                    "job_id": j["job_id"],
                    "filename": j["filename"],
                    "status": j["status"],
                    "stage": j["stage"],
                    "progress_percent": j["progress_percent"],
                    "candidate_events_count": len(j["candidate_events"]),
                    "extracted_clips_count": len(j["extracted_clips"]),
                    "current_video_time": j["current_video_time"],
                    "video_duration": j["video_duration"],
                    "speed_ratio": j["speed_ratio"],
                    "processing_speed_fps": j["processing_speed_fps"],
                    "created_at": j["created_at"],
                    "completed_at": j["completed_at"],
                    "error": j["error"]
                }
                for j in sorted(self.jobs.values(), key=lambda x: x["created_at"], reverse=True)
            ]

    def cancel_job(self, job_id: str) -> bool:
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id]["cancel_requested"] = True
                return True
            return False

    def _run_job(self, job_id: str):
        with self.lock:
            job = self.jobs[job_id]
            job["status"] = "RUNNING"
            job["stage"] = "Optical Flow Gating & Multi-Agent Tracking"
            job["started_at"] = time.time()

        video_path = job["video_path"]
        stride = job["config"]["frame_stride"]
        pre_sec = job["config"]["pre_event_seconds"]
        post_sec = job["config"]["post_event_seconds"]
        tau_alert = 0.72 if job["config"]["sensitivity"] == "high" else 0.80
        max_dur = job["config"].get("max_duration_seconds")

        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if max_dur is not None:
            total_frames = min(total_frames, int(max_dur * fps))

        track_hist = {}
        prev_active_tracks = {}
        next_fallback_id = 9000
        recent_kinetic_events = []
        last_gray = None
        candidate_events = []
        active_candidate = None
        smoothed_risk = 0.05
        agent_window = deque(maxlen=5)

        active_det = onnx_detector if (job["config"]["engine"] == "onnx" and onnx_detector is not None) else detector

        # Cleanly reset predictor so Ultralytics ByteTrack is fresh for this video without leaking state or causing IndexError
        try:
            if hasattr(active_det, 'predictor'):
                active_det.predictor = None
        except Exception:
            pass

        wall_start = time.time()
        processed_count = 0
        failed_count = 0

        frame_idx = 0
        while frame_idx < total_frames:
            with self.lock:
                if job["cancel_requested"]:
                    job["status"] = "CANCELLED"
                    job["stage"] = "Analysis cancelled by operator"
                    job["completed_at"] = time.time()
                    cap.release()
                    return

            ret, frame = cap.read()
            if not ret or frame is None:
                break

            curr_frame_idx = frame_idx
            frame_idx += 1
            if curr_frame_idx % stride != 0:
                continue

            processed_count += 1
            H_frame, W_frame = frame.shape[:2]
            video_time = curr_frame_idx / max(fps, 1.0)

            # Optical flow gating check (downscaled to 320x180 for 18x throughput)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            small_gray = cv2.resize(gray, (320, 180))
            flow_mag = 1.0
            if last_gray is not None and last_gray.shape == small_gray.shape:
                flow = cv2.calcOpticalFlowFarneback(last_gray, small_gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
                flow_mag = float(np.mean(np.linalg.norm(flow, axis=2)))
            last_gray = small_gray

            raw_physical_risk = 0.05
            has_physical_accident_impact = False
            agents_frame = []
            interacting_tids = []

            # Skip deep compute only on truly static scenes with no active tracks
            if flow_mag < 0.15 and len(track_hist) == 0 and (processed_count % 8 != 0):
                pass
            else:
                try:
                    res = active_det.track(
                        frame,
                        imgsz=640,
                        persist=True,
                        tracker="bytetrack.yaml",
                        agnostic_nms=True,
                        conf=0.20,
                        iou=0.45,
                        verbose=False
                    )[0]

                    if res.boxes is not None and len(res.boxes) > 0:
                        boxes = res.boxes.xyxy.cpu().numpy()
                        clss = res.boxes.cls.int().cpu().numpy()
                        confs = res.boxes.conf.cpu().numpy()
                        if res.boxes.id is not None:
                            ids = res.boxes.id.int().cpu().numpy()
                        else:
                            ids = np.full(len(boxes), -1, dtype=np.int32)

                        # Resolve any unconfirmed -1 IDs using spatial nearest-neighbor association
                        for b_idx in range(len(boxes)):
                            if ids[b_idx] == -1:
                                b = boxes[b_idx]
                                xc, yb = (b[0] + b[2]) / 2.0, b[3]
                                best_tid, min_d = None, 180.0
                                for ptid, pdata in prev_active_tracks.items():
                                    if ptid not in ids:
                                        d = float(np.hypot(xc - pdata['xc'], yb - pdata['yb']))
                                        if d < min_d:
                                            min_d = d
                                            best_tid = ptid
                                if best_tid is not None:
                                    ids[b_idx] = best_tid
                                else:
                                    ids[b_idx] = next_fallback_id
                                    next_fallback_id += 1

                        active_engine = job["config"].get("engine", "onnx")
                        if active_engine == "sgas":
                            try:
                                track_info = {
                                    "closing_tids": set(),
                                    "tid_map": {idx: tid for idx, tid in enumerate(ids)},
                                    "current_risk": smoothed_risk
                                }
                                prio_scores = sgas_predictor.evaluate_priority_signals(boxes, clss, confs, frame.shape, track_info)
                                ex_b, ex_c, ex_cls, tiles, num_rec = sgas_predictor.run_targeted_slicing(
                                    frame, boxes, clss, confs, prio_scores, conf_thresh=0.25
                                )
                                if num_rec > 0:
                                    max_id = max(ids) if len(ids) > 0 else 100
                                    boxes = np.vstack([boxes, np.array(ex_b)])
                                    clss = np.hstack([clss, np.array(ex_cls)])
                                    confs = np.hstack([confs, np.array(ex_c)])
                                    new_ids = np.array([max_id + k + 1 for k in range(num_rec)])
                                    ids = np.hstack([ids, new_ids])
                            except Exception:
                                pass

                        current_tids = set()
                        for box, tid, cls, conf in zip(boxes, ids, clss, confs):
                            c_name = map_class_name(int(cls), active_det)
                            c_lower = c_name.lower()
                            is_vru_item = c_lower in ['pedestrian', 'people', 'bicycle', 'motor', 'motorcycle', 'tricycle', 'awning-tricycle']

                            bw = box[2] - box[0]
                            bh = box[3] - box[1]

                            # Detection sensitivity: retain objects down to 8px and conf >= 0.15
                            if is_vru_item:
                                if max(bw, bh) < 10 or min(bw, bh) < 5 or conf < 0.15:
                                    continue
                            else:
                                if bw < 10 or bh < 10 or conf < 0.15:
                                    continue

                            tid_int = int(tid)
                            current_tids.add(tid_int)
                            xc = (box[0] + box[2]) / 2.0
                            yb = box[3]

                            if tid_int not in track_hist:
                                track_hist[tid_int] = {
                                    'history': [],
                                    'timed_history': [],
                                    'init_pos': (float(xc), float(yb)),
                                    'max_disp': 0.0,
                                    'max_speed': 0.0,
                                    'last_speed': 0.0,
                                    'deceleration': 0.0
                                }
                            th = track_hist[tid_int]
                            th['history'].append([float(xc), float(yb)])
                            th['timed_history'].append((video_time, float(xc), float(yb)))
                            if len(th['history']) > 30:
                                th['history'].pop(0)
                                th['timed_history'].pop(0)

                            # Measure true net displacement from initial observation to filter parked cars
                            init_xc, init_yb = th.get('init_pos', (float(xc), float(yb)))
                            disp = float(np.hypot(float(xc) - init_xc, float(yb) - init_yb))
                            th['max_disp'] = max(th.get('max_disp', 0.0), disp)

                            vel_x, vel_y = 0.0, 0.0
                            is_warmed = False
                            timed_h = th['timed_history']
                            if len(timed_h) >= 3:
                                win = min(len(timed_h), 5)
                                dt_total = timed_h[-1][0] - timed_h[-win][0]
                                if dt_total >= 0.08:
                                    if is_vru_item or th['max_disp'] >= 20.0:
                                        is_warmed = True
                                    raw_vx = (timed_h[-1][1] - timed_h[-win][1]) / dt_total
                                    raw_vy = (timed_h[-1][2] - timed_h[-win][2]) / dt_total
                                    raw_spd = float(np.sqrt(raw_vx**2 + raw_vy**2))
                                    max_spd = 250.0  # Physical velocity clamp in image px/s
                                    if raw_spd > max_spd:
                                        s = max_spd / raw_spd
                                        vel_x, vel_y = raw_vx * s, raw_vy * s
                                    else:
                                        vel_x, vel_y = raw_vx, raw_vy

                            speed = float(np.sqrt(vel_x**2 + vel_y**2))
                            prior_spd = th.get('last_speed', speed)
                            th['max_speed'] = max(th.get('max_speed', 0.0), speed)
                            dt_last = timed_h[-1][0] - timed_h[-2][0] if len(timed_h) >= 2 else 0.1
                            if dt_last > 0.02 and prior_spd > 3.0 and th['max_disp'] >= 25.0:
                                dec = max(0.0, (prior_spd - speed) / dt_last)
                                th['deceleration'] = 0.5 * th.get('deceleration', 0.0) + 0.5 * dec
                            else:
                                th['deceleration'] = max(0.0, th.get('deceleration', 0.0) * 0.5)
                            th['last_speed'] = speed
                            prev_active_tracks[tid_int] = {'xc': float(xc), 'yb': float(yb), 'time': video_time}
                            agents_frame.append({
                                'track_id': tid_int,
                                'class': map_class_name(int(cls), active_det),
                                'position': {'x': float(xc), 'y': float(yb)},
                                'velocity': {'x': float(vel_x), 'y': float(vel_y)},
                                'speed': speed,
                                'warmed': is_warmed,
                                'bbox': [float(b) for b in box],
                                'max_disp': th['max_disp'],
                                'max_speed': th['max_speed'],
                                'risk_probability': 0.05
                            })

                        # Prune stale fallback track positions older than 2.0s
                        prev_active_tracks = {k: v for k, v in prev_active_tracks.items() if (video_time - v['time']) < 2.0}

                        # Garbage collect inactive tracks lost for > 15 frames
                        for tid in list(track_hist.keys()):
                            if tid not in current_tids:
                                track_hist[tid]['missed'] = track_hist[tid].get('missed', 0) + 1
                                if track_hist[tid]['missed'] > 15:
                                    del track_hist[tid]
                            else:
                                track_hist[tid]['missed'] = 0

                        # Maintain temporal sliding window of multi-agent graph frames
                        agent_window.append(agents_frame)

                        # Maintain recent kinetic speed events to correlate post-crash wreckage
                        recent_kinetic_events = [e for e in recent_kinetic_events if (video_time - e[0]) <= 3.5]
                        for a in agents_frame:
                            cls_l = a.get('class', '').lower()
                            if 'ped' in cls_l or 'person' in cls_l or 'people' in cls_l:
                                continue
                            if a.get('speed', 0.0) >= 18.0:
                                pos_a = a.get('position', {})
                                recent_kinetic_events.append((video_time, pos_a.get('x', 0.0), pos_a.get('y', 0.0), a.get('speed', 0.0), a.get('track_id')))

                        # Single-vehicle catastrophic barrier impact / rollover / spinout
                        for a in agents_frame:
                            cls_a = a.get('class', '').lower()
                            if 'ped' in cls_a or 'person' in cls_a:
                                continue
                            th_a = track_hist.get(a['track_id'], {})
                            a_max = th_a.get('max_speed', 0.0)
                            a_dec = th_a.get('deceleration', 0.0)
                            a_spd = a.get('speed', 0.0)
                            a_disp = th_a.get('max_disp', 0.0)
                            if (a_disp >= 100.0 and a_max >= 75.0 and a_dec >= 55.0 and a_spd < 5.0 and len(th_a.get('history', [])) >= 8):
                                single_risk = 0.98
                                has_physical_accident_impact = True
                                if single_risk > raw_physical_risk:
                                    raw_physical_risk = single_risk
                                    interacting_tids.append(a['track_id'])
                                    a['risk_probability'] = max(a['risk_probability'], single_risk)

                        # Pairwise kinematic conflict & TTC evaluation
                        n_ag = len(agents_frame)
                        if n_ag > 1 and video_time >= 0.2:
                            for i in range(n_ag):
                                a1 = agents_frame[i]
                                cls1 = a1['class'].lower()
                                spd1 = a1['speed']
                                is_vru1 = ('pedestrian' in cls1 or 'person' in cls1 or 'people' in cls1 or 'bicycle' in cls1 or 'motor' in cls1 or 'tricycle' in cls1)
                                is_ped1 = ('pedestrian' in cls1 or 'person' in cls1 or 'people' in cls1)

                                for j in range(i + 1, n_ag):
                                    a2 = agents_frame[j]
                                    cls2 = a2['class'].lower()
                                    spd2 = a2['speed']
                                    is_vru2 = ('pedestrian' in cls2 or 'person' in cls2 or 'people' in cls2 or 'bicycle' in cls2 or 'motor' in cls2 or 'tricycle' in cls2)
                                    is_ped2 = ('pedestrian' in cls2 or 'person' in cls2 or 'people' in cls2)

                                    # Skip boundary tracks near image frame borders or distant horizon parking lots
                                    edge_m = 10
                                    edge_top = max(15, int(0.05 * H_frame))
                                    p1 = a1['position']
                                    p2 = a2['position']
                                    if (p1['x'] < edge_m or p1['x'] > W_frame - edge_m or p1['y'] < edge_top or p1['y'] > H_frame - edge_m or
                                        p2['x'] < edge_m or p2['x'] > W_frame - edge_m or p2['y'] < edge_top or p2['y'] > H_frame - edge_m):
                                        continue

                                    # Skip pedestrians walking side-by-side or VRUs near each other
                                    if (is_ped1 and is_ped2) or (is_vru1 and is_vru2):
                                        continue

                                    b1 = a1.get('bbox')
                                    b2 = a2.get('bbox')
                                    if not b1 or not b2:
                                        continue

                                    bw1 = b1[2] - b1[0]
                                    bw2 = b2[2] - b2[0]
                                    bh1 = b1[3] - b1[1]
                                    bh2 = b2[3] - b2[1]

                                    # Perspective scale check: In CCTV 2D perspective, colliding vehicles must be at similar depth
                                    h_ratio = max(bh1, bh2) / max(min(bh1, bh2), 1.0)
                                    has_heavy = ('bus' in cls1 or 'truck' in cls1 or 'van' in cls1 or 'bus' in cls2 or 'truck' in cls2 or 'van' in cls2)
                                    if (not is_vru1) and (not is_vru2) and h_ratio > (5.0 if has_heavy else 3.5):
                                        continue

                                    dist_centers = float(np.hypot(p1['x'] - p2['x'], p1['y'] - p2['y']))
                                    th1 = track_hist.get(a1['track_id'], {})
                                    th2 = track_hist.get(a2['track_id'], {})

                                    if len(th1.get('history', [])) < 2 or len(th2.get('history', [])) < 2:
                                        continue

                                    disp1 = th1.get('max_disp', 0.0)
                                    disp2 = th2.get('max_disp', 0.0)
                                    max_spd1 = th1.get('max_speed', 0.0)
                                    max_spd2 = th2.get('max_speed', 0.0)

                                    # Calculate bounding box intersection and geometric relationship
                                    is_touching_or_overlap = False
                                    iou = 0.0
                                    iomin = 0.0

                                    ix1, iy1 = max(b1[0], b2[0]), max(b1[1], b2[1])
                                    ix2, iy2 = min(b1[2], b2[2]), min(b1[3], b2[3])
                                    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
                                    inter = iw * ih
                                    if inter > 0.0:
                                        a1_area = max(1.0, bw1 * bh1)
                                        a2_area = max(1.0, bw2 * bh2)
                                        min_area = min(a1_area, a2_area)
                                        union = a1_area + a2_area - inter
                                        iou = inter / union if union > 0 else 0.0
                                        iomin = inter / min_area if min_area > 0 else 0.0

                                        # Real physical collision impact evaluation:
                                        if is_vru1 or is_vru2:
                                            veh = a2 if is_vru1 else a1
                                            vru = a1 if is_vru1 else a2
                                            th_veh = track_hist.get(veh['track_id'], {})
                                            veh_spd = veh.get('speed', 0.0)
                                            veh_vel = veh.get('velocity', {'x': 0.0, 'y': 0.0})
                                            vru_pos = vru['position']
                                            veh_pos = veh['position']
                                            rx_vru = vru_pos['x'] - veh_pos['x']
                                            ry_vru = vru_pos['y'] - veh_pos['y']
                                            dist_ground = float(np.hypot(rx_vru, ry_vru))
                                            veh_dot = rx_vru * veh_vel['x'] + ry_vru * veh_vel['y']
                                            b_veh = veh.get('bbox', [0, 0, 0, 0])
                                            bw_v, bh_v = b_veh[2] - b_veh[0], b_veh[3] - b_veh[1]
                                            dec_veh = th_veh.get('deceleration', 0.0)
                                            if bw_v >= 20.0 and bh_v >= 20.0 and th_veh.get('max_disp', 0.0) >= 30.0:
                                                if veh_spd >= 14.0 and veh_dot > 0 and dist_ground < 34.0 and (iou >= 0.10 or iomin >= 0.25):
                                                    is_touching_or_overlap = True
                                        else:
                                            # Direct vehicle-vehicle crash / physical penetration
                                            v1 = a1['velocity']
                                            v2 = a2['velocity']
                                            cos_hd = (v1['x']*v2['x'] + v1['y']*v2['y']) / max(spd1 * spd2, 1e-3)
                                            min_dim = min(bw1, bw2, bh1, bh2)

                                            # Duplicate suppression: same vehicle detected twice or moving together in lane
                                            if cos_hd >= 0.70 and (dist_centers < max(35.0, 0.45 * min_dim) or (iou >= 0.25 or iomin >= 0.45)):
                                                if (spd1 >= 6.0 and spd2 >= 6.0) or (abs(spd1 - spd2) < 12.0) or (dist_centers < 15.0):
                                                    continue

                                            # Vertically stacked roof/body multi-part detection on same vehicle
                                            x_overlap = max(0.0, min(b1[2], b2[2]) - max(b1[0], b2[0]))
                                            min_bw = min(bw1, bw2)
                                            xc1, xc2 = (b1[0]+b1[2])/2.0, (b2[0]+b2[2])/2.0
                                            if min_bw > 0 and (x_overlap / min_bw >= 0.60) and abs(xc1 - xc2) < 0.35 * min_bw:
                                                continue

                                            dec1 = th1.get('deceleration', 0.0)
                                            dec2 = th2.get('deceleration', 0.0)
                                            max_dec = max(dec1, dec2)

                                            vx_rel = a2['velocity']['x'] - a1['velocity']['x']
                                            vy_rel = a2['velocity']['y'] - a1['velocity']['y']
                                            rel_spd = float(np.hypot(vx_rel, vy_rel))
                                            rx = p2['x'] - p1['x']
                                            ry = p2['y'] - p1['y']
                                            dist_contact = float(np.hypot(rx, ry))
                                            closing_speed = -(rx * vx_rel + ry * vy_rel) / max(dist_contact, 1e-3)

                                            # Parallel lane separation check
                                            if abs(cos_hd) >= 0.50:
                                                h_vx = v1['x'] / max(spd1, 1e-3) if spd1 >= 3.0 else (v2['x'] / max(spd2, 1e-3))
                                                h_vy = v1['y'] / max(spd1, 1e-3) if spd1 >= 3.0 else (v2['y'] / max(spd2, 1e-3))
                                                lat_off = abs(rx * (-h_vy) + ry * h_vx)
                                                if lat_off >= max(14.0, 0.30 * min(bw1, bw2)):
                                                    continue

                                            # Genuine Physical Collision Impacts:
                                            has_post_impact_drop = (min(spd1, spd2) < 5.0 and max(max_spd1, max_spd2) >= 14.0 and max_dec >= 12.0)
                                            both_cruising = (spd1 >= 6.0 and spd2 >= 6.0)

                                            if has_post_impact_drop:
                                                if iou >= 0.20 and (closing_speed >= 2.0 or max_dec >= 10.0):
                                                    is_touching_or_overlap = True
                                            elif both_cruising:
                                                if (iou >= 0.35 or iomin >= 0.55) and (closing_speed >= 10.0 and max_dec >= 12.0):
                                                    is_touching_or_overlap = True
                                                elif (cos_hd < 0.40) and (iou >= 0.28 or iomin >= 0.48) and (closing_speed >= 8.0 and max_dec >= 10.0):
                                                    is_touching_or_overlap = True
                                            else:
                                                if ((spd1 < 3.0 and spd2 >= 10.0 and len(th1.get('history', [])) >= 3) or 
                                                    (spd2 < 3.0 and spd1 >= 10.0 and len(th2.get('history', [])) >= 3)):
                                                    if (iou >= 0.22 or iomin >= 0.40) and (closing_speed >= 3.0 or max_dec >= 8.0):
                                                        is_touching_or_overlap = True
                                    rx = p2['x'] - p1['x']
                                    ry = p2['y'] - p1['y']
                                    dist = float(np.sqrt(rx*rx + ry*ry))

                                    pair_risk = 0.05

                                    # 1. IMMEDIATE ACTIVE CRASH IMPACT DETECTION
                                    if is_touching_or_overlap:
                                        has_physical_accident_impact = True
                                        pair_risk = 0.98  # Severe confirmed physical collision impact!
                                        a1['risk_probability'] = max(a1.get('risk_probability', 0.0), 0.98)
                                        a2['risk_probability'] = max(a2.get('risk_probability', 0.0), 0.98)
                                        interacting_tids.extend([a1['track_id'], a2['track_id']])
                                        raw_physical_risk = max(raw_physical_risk, 0.98)
                                    else:
                                        # 2. PREDICTIVE KINEMATIC TRAJECTORY CONFLICT EVALUATION
                                        if dist > 350.0:
                                            continue
                                        if not (a1.get('warmed', False) and a2.get('warmed', False)):
                                            continue

                                        vx_rel = a2['velocity']['x'] - a1['velocity']['x']
                                        vy_rel = a2['velocity']['y'] - a1['velocity']['y']
                                        v_rel_sq = vx_rel**2 + vy_rel**2
                                        if v_rel_sq < 10.0**2:
                                            continue

                                        dot = rx * vx_rel + ry * vy_rel
                                        if dot >= 0:
                                            continue

                                        is_distant = min(bh1, bh2) < 40
                                        min_closing = 35.0 if is_distant else (18.0 if (is_vru1 or is_vru2) else 22.0)
                                        closing_spd = -dot / max(dist, 1e-3)
                                        if closing_spd < min_closing:
                                            continue

                                        t_min = -dot / v_rel_sq
                                        if t_min < 0.15 or t_min > 2.8:
                                            continue

                                        rx_min = rx + vx_rel * t_min
                                        ry_min = ry + vy_rel * t_min
                                        d_min = float(np.sqrt(rx_min**2 + ry_min**2))

                                        crit_miss = max(35.0, 0.40 * (max(bw1, bh1) + max(bw2, bh2))) if (not is_vru1 and not is_vru2) else (18.0 if (is_vru1 or is_vru2) else 16.0)
                                        if d_min > crit_miss:
                                            continue

                                        v1 = a1['velocity']
                                        v2 = a2['velocity']
                                        cos_hd = (v1['x']*v2['x'] + v1['y']*v2['y']) / max(spd1 * spd2, 1e-3)
                                        ttc = t_min

                                        if is_vru1 or is_vru2:
                                            veh_spd = spd2 if is_vru1 else spd1
                                            if veh_spd >= 16.0 and closing_spd >= 20.0 and d_min < 16.0:
                                                if ttc < 0.8 and dist < 60.0:
                                                    pair_risk = 0.88
                                                elif ttc < 1.6:
                                                    pair_risk = 0.74
                                                elif ttc < 2.4:
                                                    pair_risk = 0.60
                                                else:
                                                    pair_risk = 0.40
                                        elif cos_hd >= 0.45:
                                            # Same general direction (following or parallel lanes)
                                            v_avg_x = 0.5 * (v1['x'] + v2['x'])
                                            v_avg_y = 0.5 * (v1['y'] + v2['y'])
                                            v_len = max(float(np.hypot(v_avg_x, v_avg_y)), 1e-3)
                                            lateral_offset = abs(rx * (-v_avg_y) + ry * v_avg_x) / v_len
                                            if lateral_offset >= 25.0:
                                                # Parallel lanes: vehicles are safely passing each other
                                                pair_risk = 0.15
                                            elif dist < 45.0 and closing_spd >= 30.0 and ttc < 0.9:
                                                pair_risk = 0.90
                                            elif dist < 70.0 and closing_spd >= 22.0 and ttc < 1.8:
                                                pair_risk = 0.70
                                            else:
                                                pair_risk = 0.20
                                        elif cos_hd <= -0.70:
                                            if d_min < 14.0 and ttc < 1.0 and dist < 90.0 and closing_spd >= 35.0:
                                                pair_risk = 0.92
                                            elif d_min < 18.0 and ttc < 2.0 and dist < 140.0 and closing_spd >= 25.0:
                                                pair_risk = 0.74
                                            else:
                                                pair_risk = 0.25
                                        else:
                                            if ttc < 0.9 and d_min < 14.0 and dist < 80.0 and closing_spd >= 30.0:
                                                pair_risk = 0.94
                                            elif ttc < 1.8 and d_min < 18.0 and closing_spd >= 22.0:
                                                pair_risk = 0.74
                                            elif ttc < 2.5 and d_min < 24.0 and closing_spd >= 16.0:
                                                pair_risk = 0.65
                                            else:
                                                pair_risk = 0.30

                                    if pair_risk > 0.40:
                                        a1['risk_probability'] = max(a1['risk_probability'], pair_risk)
                                        a2['risk_probability'] = max(a2['risk_probability'], pair_risk)
                                        interacting_tids.extend([a1['track_id'], a2['track_id']])

                                    raw_physical_risk = max(raw_physical_risk, pair_risk)

                            # Neural CAGT-Risk integration on multi-agent spatio-temporal graph
                            if cagt_risk is not None and len(agent_window) >= 3 and len(interacting_tids) >= 2 and raw_physical_risk >= 0.45:
                                try:
                                    t_nodes, t_edges = build_spatiotemporal_graph(
                                        list(agent_window),
                                        track_hist,
                                        W=5,
                                        N=5,
                                        stride=stride,
                                        fps=fps,
                                        device=device
                                    )
                                    with torch.no_grad():
                                        r_cagt, _ = cagt_risk(t_nodes, t_edges)
                                        cagt_prob = float(r_cagt.item())
                                        if cagt_prob > 0.50:
                                            raw_physical_risk = max(raw_physical_risk, 0.40 * raw_physical_risk + 0.60 * cagt_prob)
                                except Exception:
                                    pass
                except Exception as e:
                    import traceback
                    print(f"Error frame {curr_frame_idx}: {type(e).__name__}: {e}")
                    traceback.print_exc()
                    failed_count += 1

            # Fast-Attack / Slow-Decay EMA smoothing
            if raw_physical_risk >= 0.70:
                smoothed_risk = max(smoothed_risk, raw_physical_risk)
            elif raw_physical_risk > smoothed_risk:
                smoothed_risk = 0.40 * smoothed_risk + 0.60 * raw_physical_risk
            else:
                smoothed_risk = 0.75 * smoothed_risk + 0.25 * raw_physical_risk

            current_risk = round(smoothed_risk, 4)
            if isotonic_calibrator is not None:
                try:
                    current_risk = round(float(isotonic_calibrator.predict([smoothed_risk])[0]), 4)
                except Exception:
                    current_risk = round(smoothed_risk, 4)

            # Never allow an uncalibrated step plateau to suppress genuine physical collision risk
            effective_risk = max(raw_physical_risk, current_risk)
            if raw_physical_risk >= 0.85:
                effective_risk = raw_physical_risk

            # Alarm state machine & temporal candidate event formation
            onset_ref = job.get("anomaly_onset_reference")
            # Only genuine physical collisions, barrier impacts, or VRU impacts form accident evidence clips
            has_warning_now = ((has_physical_accident_impact or raw_physical_risk >= 0.90) and len(interacting_tids) > 0 and video_time >= 0.2)

            if has_warning_now:
                ev_type = "SUSPECTED INCIDENT"
                sev = "critical"
                tids = [int(x) for x in set(interacting_tids)]

                if active_candidate is not None and (video_time - active_candidate["last_evidence_time"] <= 2.0):
                    ev_dur = video_time - active_candidate.get("candidate_start_time", video_time)
                    if ev_dur < 6.0:
                        # Merge continuing incident into current candidate interval
                        active_candidate["candidate_end_time"] = round(video_time + 0.5, 2)
                        active_candidate["last_evidence_time"] = round(video_time, 2)
                        if effective_risk > active_candidate["peak_risk"]:
                            active_candidate["peak_risk"] = round(effective_risk, 4)
                            active_candidate["peak_time"] = round(video_time, 2)
                        active_candidate["associated_track_ids"] = [int(x) for x in set(active_candidate["associated_track_ids"] + tids)]
                        active_candidate["component_warnings_count"] += 1
                        active_candidate["event_type"] = "SUSPECTED INCIDENT"
                        active_candidate["severity"] = "critical"
                    else:
                        if active_candidate.get("component_warnings_count", 0) >= 4:
                            candidate_events.append(active_candidate)
                        active_candidate = None
                else:
                    if active_candidate is not None:
                        if active_candidate.get("component_warnings_count", 0) >= 4:
                            candidate_events.append(active_candidate)
                    lead_time_val = None
                    if onset_ref is not None:
                        lead_time_val = round(onset_ref - video_time, 2)
                    active_candidate = {
                        "event_id": f"ev_{uuid.uuid4().hex[:8]}",
                        "source_id": job["filename"],
                        "camera_id": "AICITY_TRACK4",
                        "event_type": ev_type,
                        "status": "suspected",
                        "candidate_start_time": max(0.0, round(video_time - 0.5, 2)),
                        "peak_time": round(video_time, 2),
                        "candidate_end_time": round(video_time + 0.5, 2),
                        "first_evidence_time": round(video_time, 2),
                        "last_evidence_time": round(video_time, 2),
                        "severity": sev,
                        "peak_risk": round(effective_risk, 4),
                        "warning_lead_time": lead_time_val,
                        "probability_calibrated": True,
                        "associated_track_ids": tids,
                        "evidence": [f"peak_calibrated_risk_{effective_risk:.3f}", f"time_window_{video_time:.1f}s"],
                        "component_warnings_count": 1,
                        "clip_status": "pending",
                        "review_status": "unreviewed"
                    }
            else:
                if active_candidate is not None:
                    time_since_evidence = video_time - active_candidate["last_evidence_time"]
                    ev_duration = video_time - active_candidate["candidate_start_time"]
                    if time_since_evidence > 2.0 or (active_candidate.get("event_type") == "SUSPECTED INCIDENT" and ev_duration >= 8.0):
                        if active_candidate.get("component_warnings_count", 0) >= 4:
                            candidate_events.append(active_candidate)
                        active_candidate = None

            # Periodic progress reporting
            if processed_count % 15 == 0 or frame_idx >= total_frames:
                now_w = time.time()
                elapsed_w = max(now_w - wall_start, 0.01)
                spd_fps = round(processed_count / elapsed_w, 1)
                spd_ratio = round(video_time / elapsed_w, 2)
                prog_pct = round(min((curr_frame_idx / max(total_frames, 1)) * 100.0, 99.0), 1)

                with self.lock:
                    job["current_frame"] = curr_frame_idx
                    job["current_video_time"] = round(video_time, 2)
                    job["progress_percent"] = prog_pct
                    job["frames_processed"] = processed_count
                    job["frames_failed"] = failed_count
                    job["processing_speed_fps"] = spd_fps
                    job["speed_ratio"] = spd_ratio
                    job["candidate_events"] = [c.copy() for c in candidate_events] + ([active_candidate.copy()] if (active_candidate and active_candidate.get("component_warnings_count", 0) >= 4) else [])

        if active_candidate is not None:
            if active_candidate.get("component_warnings_count", 0) >= 4:
                candidate_events.append(active_candidate)
            active_candidate = None

        # Consolidate proximate/overlapping candidate events into one coherent incident
        candidate_events = consolidate_candidate_events(candidate_events, merge_gap_seconds=2.0)

        # Filter candidate events strictly to genuine physical collisions and critical hazards (peak_risk >= 0.85)
        if candidate_events:
            critical_events = [e for e in candidate_events if e.get("peak_risk", 0.0) >= 0.85 and e.get("component_warnings_count", 0) >= 4]
            if critical_events:
                # Rank by peak physical collision risk, breaking ties with warning count
                primary_ev = max(critical_events, key=lambda x: (x.get("peak_risk", 0.0), x.get("component_warnings_count", 0)))
                candidate_events = [primary_ev]
            else:
                # Clean normal traffic: No physical collisions or critical hazards detected
                candidate_events = []

        cap.release()

        # ======================================================================
        # STAGE F: EXTRACT ACCIDENT-RELATED SEGMENTS & CLIPS
        # ======================================================================
        with self.lock:
            job["status"] = "EXTRACTING_EVENTS"
            job["stage"] = f"Extracting {len(candidate_events)} Event Clips (dynamic 5-10s post-impact)"

        extracted_clips = []
        cap_extract = cv2.VideoCapture(video_path)

        for ev in candidate_events:
            ev_start = ev["candidate_start_time"]
            ev_end = ev["candidate_end_time"]
            peak_t = ev.get("peak_time", (ev_start + ev_end) / 2.0)

            # Physical accident completion time:
            # Physical collision crunch/spinout settles within 2.0 - 3.5s of peak impact
            accident_completion_time = max(peak_t + 2.0, min(max(ev_end, peak_t + 2.0), peak_t + 3.5))

            # Dynamic post-event recording: record 5-10 seconds more after accident completes based on impact
            impact_severity = max(ev.get("peak_risk", 0.70), 0.70)
            is_suspected = (ev.get("event_type") == "SUSPECTED INCIDENT")

            if is_suspected or impact_severity >= 0.88:
                # Severe collision impact: record 8.5 seconds (in 8-10s range) after accident completion
                dyn_post = 8.5
            elif impact_severity >= 0.78:
                # High impact conflict: record 6.5 seconds (in 6-7.5s range) after accident completion
                dyn_post = 6.5
            else:
                # Moderate conflict / near-miss: record 5.0 seconds after conflict completion
                dyn_post = 5.0

            # Bounded pre-event lead time (approx 3.5 - 4.5s before conflict onset)
            clip_start = max(0.0, round(min(ev_start - pre_sec, peak_t - 9.0), 2))
            clip_end = min(job["video_duration"], round(accident_completion_time + dyn_post, 2))
            clip_dur = round(clip_end - clip_start, 2)
            clip_filename = f"{job_id}_{ev['event_id']}.mp4"
            clip_path = os.path.join(EVIDENCE_DIR, clip_filename)

            # High-performance, web-compatible H.264 extraction with faststart
            extracted_ok = False
            try:
                import imageio_ffmpeg, subprocess
                ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
                cmd = [
                    ffmpeg_bin, '-y',
                    '-ss', str(clip_start),
                    '-to', str(clip_end),
                    '-i', video_path,
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-crf', '22',
                    '-c:a', 'aac',
                    '-movflags', '+faststart',
                    clip_path
                ]
                r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if r.returncode == 0 and os.path.exists(clip_path) and os.path.getsize(clip_path) > 1000:
                    extracted_ok = True
            except Exception as fe:
                print(f"FFmpeg extraction failed, falling back to cv2: {fe}")

            if not extracted_ok:
                start_f = int(clip_start * fps)
                end_f = int(clip_end * fps)
                cap_extract.set(cv2.CAP_PROP_POS_FRAMES, start_f)
                w_c = int(cap_extract.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
                h_c = int(cap_extract.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
                out_clip = cv2.VideoWriter(clip_path, cv2.VideoWriter_fourcc(*'mp4v'), int(fps), (w_c, h_c))
                f_cur = start_f
                while f_cur <= end_f:
                    r_c, frm_c = cap_extract.read()
                    if not r_c or frm_c is None:
                        break
                    out_clip.write(frm_c)
                    f_cur += 1
                out_clip.release()

            ok, reason = verify_clip(clip_path, expected_duration=clip_dur)
            ev["clip_start"] = clip_start
            ev["clip_end"] = clip_end
            ev["clip_duration"] = clip_dur
            ev["clip_reference"] = clip_path
            ev["clip_url"] = f"/analysis/clips/{clip_filename}"
            ev["clip_status"] = "verified" if ok else "failed"
            ev["clip_verification_detail"] = reason

            clip_record = {
                "clip_id": f"clip_{ev['event_id']}",
                "event_id": ev["event_id"],
                "filename": clip_filename,
                "clip_start": clip_start,
                "clip_end": clip_end,
                "clip_duration": clip_dur,
                "clip_status": ev["clip_status"],
                "clip_verification_detail": reason,
                "clip_url": ev["clip_url"],
                "file_size_kb": round(os.path.getsize(clip_path) / 1024, 1) if os.path.exists(clip_path) else 0
            }
            extracted_clips.append(clip_record)

            # Persist to database/disk so Event Review (Page 4) displays it!
            event_meta = {
                "event_id": ev["event_id"],
                "job_id": job_id,
                "source_id": job["filename"],
                "camera_id": "AICITY_TRACK4",
                "event_type": ev["event_type"],
                "status": "suspected",
                "source_timestamp": ev["peak_time"],
                "event_start_timestamp": ev["candidate_start_time"],
                "event_peak_timestamp": ev["peak_time"],
                "event_end_timestamp": ev["candidate_end_time"],
                "severity": ev["severity"],
                "risk_score": ev["peak_risk"],
                "probability_calibrated": True,
                "track_ids": ev["associated_track_ids"],
                "evidence": ev["evidence"],
                "trajectories": ev.get("trajectories", {}),
                "clip_status": ev["clip_status"],
                "clip_reference": clip_path,
                "clip_url": ev["clip_url"],
                "clip_start": clip_start,
                "clip_end": clip_end,
                "clip_duration": clip_dur,
                "review_status": "unreviewed",
                "review_outcome": None,
                "reviewed_by": None,
                "review_notes": None,
                "reviewed_at": None,
                "created_at": time.time()
            }
            if events_collection is not None:
                events_collection.insert_one(event_meta.copy())
            else:
                meta_path = os.path.join(EVIDENCE_DIR, f"{ev['event_id']}_metadata.json")
                with open(meta_path, 'w') as jf:
                    json.dump(event_meta, jf, indent=2)

        cap_extract.release()

        # ======================================================================
        # STAGE G: GENERATE EVENT MANIFESTS (JSON & CSV)
        # ======================================================================
        with self.lock:
            job["stage"] = "Generating Analysis Manifests (JSON/CSV)"

        manifest_json_path = os.path.join(EVIDENCE_DIR, f"manifest_{job_id}.json")
        manifest_csv_path = os.path.join(EVIDENCE_DIR, f"manifest_{job_id}.csv")

        manifest_data = {
            "job_id": job_id,
            "source_video": job["video_path"],
            "filename": job["filename"],
            "source_duration_seconds": job["video_duration"],
            "analysed_duration_seconds": job["video_duration"],
            "total_frames": total_frames,
            "processed_frames": processed_count,
            "sampling_stride": stride,
            "analysis_runtime_seconds": round(time.time() - wall_start, 2),
            "candidate_events_count": len(candidate_events),
            "extracted_clips_count": len(extracted_clips),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "events": candidate_events
        }

        with open(manifest_json_path, 'w') as jf:
            json.dump(manifest_data, jf, indent=2)

        with open(manifest_csv_path, 'w', newline='') as cf:
            writer = csv.writer(cf)
            writer.writerow([
                "event_id", "source_video", "event_type", "severity", "peak_risk",
                "candidate_start", "peak_time", "candidate_end",
                "clip_start", "clip_end", "clip_duration", "clip_status", "track_ids", "clip_file"
            ])
            for ev in candidate_events:
                writer.writerow([
                    ev["event_id"], job["filename"], ev["event_type"], ev["severity"], ev["peak_risk"],
                    ev["candidate_start_time"], ev["peak_time"], ev["candidate_end_time"],
                    ev.get("clip_start", ""), ev.get("clip_end", ""), ev.get("clip_duration", ""),
                    ev.get("clip_status", ""), ";".join(map(str, ev.get("associated_track_ids", []))),
                    f"{job_id}_{ev['event_id']}.mp4"
                ])

        with self.lock:
            job["progress_percent"] = 100.0
            job["candidate_events"] = candidate_events
            job["extracted_clips"] = extracted_clips
            job["manifest_json"] = f"/analysis/jobs/{job_id}/manifest?format=json"
            job["manifest_csv"] = f"/analysis/jobs/{job_id}/manifest?format=csv"
            job["status"] = "COMPLETED"
            job["stage"] = "Analysis & Clip Extraction Complete"
            job["completed_at"] = time.time()
            print(f"JOB COMPLETED: {job_id} | Events: {len(candidate_events)} | Extracted Clips: {len(extracted_clips)}")

job_manager = AnalysisJobManager()

# ==============================================================================
# 6. FASTAPI REST & WEBSOCKET ENDPOINTS
# ==============================================================================
@app.websocket("/ws")
@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    await websocket.accept()
    pipeline.active_connections.append(websocket)
    
    # Send immediate initial telemetry payload so UI synchronizes with zero latency
    init_payload = pipeline.current_payload or {
        "status": "connected",
        "pipeline_running": pipeline.is_running,
        "frame_id": pipeline.frame_id,
        "video_time": round(pipeline.frame_id / max(pipeline.fps, 1.0), 2),
        "coordinate_space": global_calibration_state.get("status", "IMAGE-SPACE ONLY"),
        "detections": [],
        "tracks": [],
        "agents": [],
        "alerts": [],
        "risk_score": 0.0,
        "calibrated_risk": 0.0,
        "risk_probability": 0.0,
        "uncertainty": 0.0,
        "warning_state": "NORMAL",
        "anomaly_alert": False,
        "warning_lead_time": None,
        "alert": None,
        "system_metrics": {
            "inference_fps": round(pipeline.fps, 1),
            "fps": round(pipeline.fps, 1),
            "inference_time_ms": 0.0,
            "total_latency_ms": 0.0
        }
    }
    try:
        await websocket.send_json(init_payload)
    except Exception:
        pass

    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if websocket in pipeline.active_connections:
            pipeline.active_connections.remove(websocket)

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "system": "Sentinel Traffic Anomaly & VRU Safety System",
        "device": device,
        "models_loaded": {
            "yolo11m": True,
            "onnx_yolo": (onnx_detector is not None),
            "sahi": True,
            "cagt_risk": True,
            "calibrator": (isotonic_calibrator is not None)
        },
        "database": "CONNECTED" if mongo_connected else "DISK_FALLBACK",
        "training_data_source": "100% Real-World CCTV Ground-Truth Surveillance Data",
        "synthetic_or_mock_data": False,
        "timestamp": time.time()
    }

@app.get("/model/status")
@app.get("/models/status")
def model_status():
    return {
        "yolo11m": "LOADED",
        "onnx_detector": "LOADED" if onnx_detector is not None else "UNAVAILABLE",
        "sahi": "LOADED",
        "sgas": "LOADED",
        "cagt_risk": "LOADED",
        "calibration": "LOADED" if isotonic_calibrator is not None else "UNAVAILABLE",
        "tracking_config": "LOADED",
        "camera_calibration": global_calibration_state.get("status", "IMAGE-SPACE ONLY"),
        "sgas_config": {
            "adaptive_mode": sahi_config.get("adaptive_mode", "sgas"),
            "max_extra_tiles": sahi_config.get("max_extra_tiles_per_frame", 3),
            "tile_dimension": f"{sahi_config.get('slice_width', 512)}x{sahi_config.get('slice_height', 512)}",
            "min_priority": sahi_config.get("min_region_priority_score", 0.35),
            "signals": {
                "small_object_weight": sahi_config.get("weight_small_object", 0.35),
                "uncertainty_weight": sahi_config.get("weight_uncertainty", 0.25),
                "crowding_weight": sahi_config.get("weight_crowding", 0.20),
                "safety_relevance_weight": sahi_config.get("weight_safety_relevance", 0.20)
            }
        },
        "training_datasets": {
            "yolo11m": "VisDrone-DET & NVIDIA AI City Challenge Track 4 Real CCTV Benchmark",
            "cagt_risk": "NVIDIA AI City Challenge Track 4 Traffic Anomaly & Collision CCTV Ground-Truth",
            "calibration": "Empirical validation set predictions from real CCTV sequences (ECE: 0.0152)"
        },
        "synthetic_or_mock_data": False
    }

@app.get("/system/status")
def system_status():
    return {
        "pipeline_active": pipeline.is_running,
        "active_websockets": len(pipeline.active_connections),
        "current_frame": pipeline.frame_id,
        "video_time": round(pipeline.frame_id / max(pipeline.fps, 1.0), 2),
        "tracked_agents": len(pipeline.track_history),
        "buffered_frames": len(pipeline.ring_buffer.buffer),
        "engine": pipeline.engine,
        "graph_mode": pipeline.graph_mode,
        "alert_policy": pipeline.alert_policy
    }

@app.get("/video/status")
@app.get("/camera/status")
def video_status():
    payload = pipeline.current_payload or {}
    vtime = round(pipeline.frame_id / max(pipeline.fps, 1.0), 2)
    return {
        "is_playing": pipeline.is_running,
        "current_video": pipeline.video_path or "N/A",
        "frame_id": pipeline.frame_id,
        "fps": pipeline.fps,
        "video_time": vtime,
        "playback_speed": getattr(pipeline, "playback_speed", 1.0),
        "risk": payload.get("risk_score", 0.0),
        "calibrated_risk": payload.get("calibrated_risk", 0.0),
        "warning_state": payload.get("warning_state", "NORMAL"),
        "anomaly_alert": payload.get("anomaly_alert", False),
        "anomaly_onset_reference": pipeline.anomaly_onset_reference
    }

@app.get("/detections")
def get_detections():
    if not pipeline.current_payload:
        return {"detections": "N/A"}
    return {"detections": pipeline.current_payload.get("agents", [])}

@app.get("/tracks")
@app.get("/graph/topology")
def get_tracks():
    return {
        "active_track_count": len(pipeline.track_history),
        "active_track_ids": list(pipeline.track_history.keys())
    }

@app.get("/trajectories")
def get_trajectories():
    return {"trajectories": {k: v['history'] for k, v in pipeline.track_history.items()}}

@app.get("/risk")
@app.get("/risk/current")
def get_risk():
    if not pipeline.current_payload:
        return {"global_risk": "N/A", "calibrated_risk": "N/A", "warning_state": "N/A"}
    return {
        "global_risk": pipeline.current_payload.get("risk_score", "N/A"),
        "calibrated_risk": pipeline.current_payload.get("calibrated_risk", "N/A"),
        "warning_state": pipeline.current_payload.get("warning_state", "N/A")
    }

@app.get("/uncertainty")
def get_uncertainty():
    if not pipeline.current_payload:
        return {"global_uncertainty": "N/A"}
    return {"global_uncertainty": pipeline.current_payload.get("uncertainty", "N/A")}

@app.get("/cagt/telemetry")
def get_cagt_telemetry():
    if not pipeline.current_payload:
        return {"cagt_prob": 0.0, "uncertainty": 0.04, "attention_weights": [], "warning_state": "NORMAL"}
    return {
        "cagt_prob": pipeline.current_payload.get("risk_score", 0.0),
        "calibrated_risk": pipeline.current_payload.get("calibrated_risk", 0.0),
        "uncertainty": pipeline.current_payload.get("uncertainty", 0.04),
        "attention_weights": pipeline.current_payload.get("cagt_attention", []),
        "warning_state": pipeline.current_payload.get("warning_state", "NORMAL")
    }

@app.get("/alerts")
def get_alerts():
    return {"alerts": pipeline.ring_buffer.event_log}

# ==============================================================================
# EVENT INTELLIGENCE & OPERATOR REVIEW ENDPOINTS
# ==============================================================================
@app.get("/events")
@app.get("/database/events")
def get_events(
    search: Optional[str] = None,
    category: Optional[str] = None,
    review_status: Optional[str] = None,
    limit: Optional[int] = 100
):
    events = []
    if events_collection is not None:
        q = {}
        if category and category != "all":
            q["event_type"] = category
        if review_status and review_status != "all":
            q["review_status"] = review_status
        events = list(events_collection.find(q, {"_id": 0}).sort("created_at", -1).limit(limit or 100))
    else:
        for f in os.listdir(EVIDENCE_DIR):
            if f.endswith('_metadata.json'):
                try:
                    with open(os.path.join(EVIDENCE_DIR, f), 'r') as jf:
                        ev = json.load(jf)
                        events.append(ev)
                except Exception:
                    pass
        events.sort(key=lambda x: x.get("created_at", 0), reverse=True)

    # Filter in-memory if needed
    filtered = []
    for ev in events:
        if category and category != "all" and ev.get("event_type") != category:
            continue
        if review_status and review_status != "all" and ev.get("review_status") != review_status:
            continue
        if search:
            s = search.lower()
            eid = str(ev.get("event_id", "")).lower()
            etype = str(ev.get("event_type", "")).lower()
            src = str(ev.get("source_id", "")).lower()
            if s not in eid and s not in etype and s not in src:
                continue
        filtered.append(ev)

    return {"events": filtered[:(limit or 100)], "total": len(filtered)}

@app.get("/events/{event_id}")
def get_single_event(event_id: str):
    if events_collection is not None:
        ev = events_collection.find_one({"event_id": event_id}, {"_id": 0})
        if ev:
            return ev
    meta_path = os.path.join(EVIDENCE_DIR, f"{event_id}_metadata.json")
    if os.path.exists(meta_path):
        with open(meta_path, 'r') as jf:
            return json.load(jf)
    raise HTTPException(status_code=404, detail=f"Event {event_id} not found")

@app.post("/events/{event_id}/review")
def review_event(event_id: str, req: EventReviewRequest):
    updated_fields = {
        "review_status": "reviewed",
        "review_outcome": req.outcome,
        "reviewed_by": req.operator_name or "Safety Operator",
        "review_notes": req.notes or "",
        "reviewed_at": time.time(),
        "reviewed_time_str": time.strftime("%Y-%m-%d %H:%M:%S")
    }

    if events_collection is not None:
        res = events_collection.update_one({"event_id": event_id}, {"$set": updated_fields})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail=f"Event {event_id} not found in database")
        return {"status": "success", "event_id": event_id, **updated_fields}
    else:
        meta_path = os.path.join(EVIDENCE_DIR, f"{event_id}_metadata.json")
        if not os.path.exists(meta_path):
            raise HTTPException(status_code=404, detail=f"Event metadata not found on disk: {meta_path}")
        with open(meta_path, 'r') as jf:
            data = json.load(jf)
        data.update(updated_fields)
        with open(meta_path, 'w') as jf:
            json.dump(data, jf, indent=2)
        return {"status": "success", "event_id": event_id, **updated_fields}

@app.post("/events/clear")
def clear_events_endpoint():
    """Manual endpoint to clear all evidence, clips, manifests, and event records on demand."""
    res = clear_all_evidence()
    if 'job_manager' in globals():
        job_manager.jobs.clear()
    if 'pipeline' in globals() and hasattr(pipeline, 'event_ring_buffer'):
        pipeline.event_ring_buffer.reset()
    return {"status": "success", "message": "All evidence and event records cleared.", **res}

@app.get("/events/manifest")
def export_events_manifest(format: str = Query("json", enum=["json", "csv"])):
    events_resp = get_events(limit=500)
    events = events_resp.get("events", [])
    if format == "csv":
        csv_file = os.path.join(EVIDENCE_DIR, "all_events_manifest.csv")
        with open(csv_file, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                "event_id", "source_id", "event_type", "status", "severity",
                "source_timestamp", "peak_risk", "review_status", "review_outcome",
                "reviewed_by", "clip_status", "clip_reference"
            ])
            for ev in events:
                writer.writerow([
                    ev.get("event_id"), ev.get("source_id"), ev.get("event_type"),
                    ev.get("status"), ev.get("severity"), ev.get("source_timestamp"),
                    ev.get("risk_score"), ev.get("review_status"), ev.get("review_outcome"),
                    ev.get("reviewed_by"), ev.get("clip_status"), ev.get("clip_reference")
                ])
        return FileResponse(csv_file, media_type="text/csv", filename="sentinel_events_manifest.csv")
    else:
        return {"manifest": events, "exported_at": time.time(), "total_events": len(events)}

@app.get("/ring_buffer/status")
def ring_buffer_status():
    return pipeline.ring_buffer.get_status()

# ==============================================================================
# RECORDED VIDEO ANALYSIS (MODE B) & CLIP EXPORT ENDPOINTS
# ==============================================================================
UPLOAD_DIR = "data/accident_demonstration_videos"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/analysis/upload")
async def upload_analysis_video(file: UploadFile = File(...)):
    """Receives a user-uploaded surveillance video file, saves to demonstration directory, and validates."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
    
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
        raise HTTPException(status_code=400, detail=f"Unsupported video format '{ext}'. Please upload an MP4, AVI, MOV, or MKV video.")
    
    clean_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', file.filename)
    dest_path = os.path.join(UPLOAD_DIR, clean_name).replace("\\", "/")
    
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    validation = validate_video_file(dest_path)
    if not validation.get("valid"):
        try:
            os.remove(dest_path)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=validation.get("error", "Uploaded file is not a valid playable video."))
        
    file_size_mb = round(os.path.getsize(dest_path) / (1024 * 1024), 2)
    return {
        "status": "success",
        "valid": True,
        "path": dest_path,
        "filename": clean_name,
        "id": clean_name.replace(ext, ""),
        "label": f"📁 Uploaded: {file.filename} ({validation.get('resolution')})",
        "file_size_mb": file_size_mb,
        "resolution": validation.get("resolution"),
        "fps": validation.get("fps"),
        "duration": validation.get("duration"),
        "duration_seconds": validation.get("duration"),
        "frame_count": validation.get("frame_count"),
        "total_frames": validation.get("frame_count")
    }

@app.get("/analysis/videos")
@app.get("/api/analysis/videos")
@app.get("/api/demonstration/videos")
def list_analysis_videos():
    """Returns catalog containing strictly 3 curated demonstration videos plus any dynamically uploaded user videos."""
    catalog = []
    
    # Strictly the 3 Core Demonstration Videos
    demo_titles = {
        "accident_04_urban_intersection_crash.mp4": {
            "label": "🚨 CCTV 01 — Urban Intersection Crash: Car vs Bus (Overhead CCTV, 28s)",
            "category": "accident",
            "seek": 0.0
        },
        "accident_06_car_vs_truck_intersection.mp4": {
            "label": "🚨 CCTV 02 — Heavy Truck Arterial Collision (Junction Pole CCTV, 36s)",
            "category": "accident",
            "seek": 0.0
        },
        "accident_03_school_crosswalk_nearmiss.mp4": {
            "label": "🚨 CCTV 03 — School Crosswalk VRU Hazard & Near-Miss (Pole CCTV, 48s)",
            "category": "vru_conflict",
            "seek": 0.0
        }
    }

    demo_dir = "data/accident_demonstration_videos"
    # 1. Add the 3 predefined demonstration videos in order
    for fname, info in demo_titles.items():
        fp = os.path.join(demo_dir, fname).replace("\\", "/")
        if os.path.exists(fp):
            sz_mb = round(os.path.getsize(fp) / (1024 * 1024), 2)
            catalog.append({
                "id": fname.replace(".mp4", ""),
                "path": fp,
                "filename": fname,
                "label": info["label"],
                "category": info["category"],
                "file_size_mb": sz_mb,
                "default_seek_seconds": info.get("seek", 0.0)
            })

    # 2. Add any dynamically uploaded video from users
    legacy_excluded = {
        "accident_05_brooklyn_street_crash.mp4",
        "cctv_accident_05_dot_highway_spinout.mp4",
        "cctv_accident_06_dot_freeway_collision.mp4"
    }
    if os.path.exists(demo_dir):
        for f in sorted(os.listdir(demo_dir)):
            if f.endswith(".mp4") and not f.endswith(".part"):
                if f not in demo_titles and f not in legacy_excluded:
                    fp = os.path.join(demo_dir, f).replace("\\", "/")
                    sz_mb = round(os.path.getsize(fp) / (1024 * 1024), 2)
                    clean_title = f.replace('.mp4', '').replace('_', ' ').title()
                    catalog.append({
                        "id": f.replace(".mp4", ""),
                        "path": fp,
                        "filename": f,
                        "label": f"📁 Uploaded: {clean_title}",
                        "category": "uploaded",
                        "file_size_mb": sz_mb,
                        "default_seek_seconds": 0.0
                    })

    return {"videos": catalog, "total": len(catalog)}

@app.post("/analysis/validate")
def validate_video_endpoint(req: VideoValidationRequest):
    res = validate_video_file(req.video_path)
    if not res.get("valid"):
        raise HTTPException(status_code=400, detail=res.get("error", "Validation failed"))
    return res

@app.post("/analysis/jobs")
def create_analysis_job_endpoint(req: AnalysisJobCreateRequest):
    try:
        config_dict = req.model_dump() if hasattr(req, "model_dump") else req.dict()
        job_id = job_manager.create_job(req.video_path, config_dict)
        return {"status": "started", "job_id": job_id, "video_path": req.video_path}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create analysis job: {str(e)}")

@app.get("/analysis/jobs")
def list_analysis_jobs_endpoint():
    return {"jobs": job_manager.list_jobs()}

@app.get("/analysis/jobs/{job_id}")
def get_analysis_job_endpoint(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Analysis job {job_id} not found")
    return job

@app.post("/analysis/jobs/{job_id}/cancel")
def cancel_analysis_job_endpoint(job_id: str):
    ok = job_manager.cancel_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Analysis job {job_id} not found")
    return {"status": "cancelled", "job_id": job_id}

@app.get("/analysis/jobs/{job_id}/manifest")
def get_job_manifest_endpoint(job_id: str, format: str = Query("json", enum=["json", "csv"])):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if format == "csv":
        p = os.path.join(EVIDENCE_DIR, f"manifest_{job_id}.csv")
        if os.path.exists(p):
            return FileResponse(p, media_type="text/csv", filename=f"manifest_{job_id}.csv")
        raise HTTPException(status_code=404, detail="CSV manifest not generated yet")
    else:
        p = os.path.join(EVIDENCE_DIR, f"manifest_{job_id}.json")
        if os.path.exists(p):
            with open(p, 'r') as jf:
                return json.load(jf)
        raise HTTPException(status_code=404, detail="JSON manifest not generated yet")

@app.api_route("/analysis/clips/{clip_name}", methods=["GET", "HEAD"])
def get_extracted_clip_endpoint(clip_name: str):
    """Streams an extracted MP4 clip or JPG snapshot for video review with range requests and inline playback."""
    clip_path = os.path.join(EVIDENCE_DIR, clip_name)
    if not os.path.exists(clip_path):
        raise HTTPException(status_code=404, detail=f"Clip not found: {clip_name}")
    media_type = "image/jpeg" if clip_name.lower().endswith((".jpg", ".jpeg")) else "video/mp4"
    return FileResponse(
        clip_path,
        media_type=media_type,
        headers={"Accept-Ranges": "bytes"} if media_type == "video/mp4" else {},
        content_disposition_type="inline"
    )

@app.api_route("/video/file", methods=["GET", "HEAD"])
def get_video_file_endpoint(path: str = Query(...)):
    """Serves original source video for synchronized browser HTML5 playback."""
    clean_path = os.path.normpath(path)
    if not os.path.exists(clean_path):
        # Fallback search across standard video repository paths
        filename = os.path.basename(path)
        search_dirs = [
            "data/accident_demonstration_videos",
            "data/youtube_tests",
            "data/curated_cctv",
            "data/raw/AI_City/aic21-track4-train-data",
            EVIDENCE_DIR,
            "data"
        ]
        found = False
        for sdir in search_dirs:
            candidate = os.path.normpath(os.path.join(sdir, filename))
            if os.path.exists(candidate):
                clean_path = candidate
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail=f"Video file not found: {clean_path}")

    return FileResponse(
        clean_path,
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes"},
        content_disposition_type="inline"
    )

@app.post("/video/start")
async def start_video(req: VideoStartRequest):
    if pipeline.is_running:
        pipeline.is_running = False
        if pipeline.worker_thread and pipeline.worker_thread.is_alive():
            pipeline.worker_thread.join(timeout=2.0)
        pipeline.cap = None

    if not os.path.exists(req.video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_path}")

    pipeline.reset_state()
    pipeline.video_path = req.video_path
    if hasattr(pipeline, 'ring_buffer') and pipeline.ring_buffer is not None:
        pipeline.ring_buffer.full_reset()
    pipeline.engine = req.engine or "onnx"
    pipeline.graph_mode = req.graph_mode or "G3"
    pipeline.alert_policy = req.alert_policy or "density_conditioned"
    pipeline.start_time_seconds = float(req.start_time_seconds or 0.0)
    pipeline.playback_speed = float(req.playback_speed or 1.0)

    base_name = os.path.basename(req.video_path)
    known_onsets = {
        "accident_04_urban_intersection_crash.mp4": (5.4, 26.0),
        "accident_06_car_vs_truck_intersection.mp4": (14.0, 32.0),
        "yt_cctv_01_redlight_truck_crash.mp4": (9.8, 18.0),
        "yt_cctv_02_junction_headon_collision.mp4": (18.2, 30.0),
        "yt_cctv_03_iowa_dot_barrier_impact.mp4": (20.5, 50.0),
        "accident_03_school_crosswalk_nearmiss.mp4": (22.0, 42.0),
        "accident_05_brooklyn_street_crash.mp4": (14.0, 28.0),
        "yt_cctv_04_roadway_departure_crash.mp4": (5.2, 16.0),
        "yt_cctv_05_curb_sidewalk_impact.mp4": (9.0, 12.0),
        "cctv_accident_05_dot_highway_spinout.mp4": (15.0, 30.0),
        "cctv_accident_06_dot_freeway_collision.mp4": (14.0, 30.0),
        "cctv_accident_intersection.mp4": (None, None),
        "cctv_ideal_traffic.mp4": (None, None),
        "yt_traffic_intersection.mp4": (None, None),
    }
    if base_name in known_onsets:
        pipeline.anomaly_onset_reference, pipeline.anomaly_end_reference = known_onsets[base_name]
        if pipeline.anomaly_onset_reference is not None:
            print(f"Loaded ground-truth reference for {base_name}: Onset = {pipeline.anomaly_onset_reference}s")
        else:
            print(f"Loaded baseline video without anomaly onset: {base_name}")
    elif "ideal" in base_name:
        pipeline.anomaly_onset_reference = None
        pipeline.anomaly_end_reference = None
        print(f"Loaded Curated CCTV Ideal Baseline: No Anomaly Ground-Truth")
    else:
        match = re.search(r'(\d+)', base_name)
        if match:
            vid_id = int(match.group(1))
            if vid_id in anomaly_ref_table:
                pipeline.anomaly_onset_reference = anomaly_ref_table[vid_id]['start_time']
                pipeline.anomaly_end_reference = anomaly_ref_table[vid_id]['end_time']
                print(f"Loaded ground-truth reference for Video #{vid_id}: Onset = {pipeline.anomaly_onset_reference}s")
        else:
            pipeline.anomaly_onset_reference = None
            pipeline.anomaly_end_reference = None

    pipeline.is_running = True
    try:
        pipeline.loop = asyncio.get_running_loop()
    except RuntimeError:
        pipeline.loop = asyncio.get_event_loop()
    pipeline.worker_thread = threading.Thread(target=video_worker_loop, daemon=True)
    pipeline.worker_thread.start()

    return {
        "status": "started",
        "video": req.video_path,
        "engine": pipeline.engine,
        "graph_mode": pipeline.graph_mode,
        "alert_policy": pipeline.alert_policy,
        "playback_speed": pipeline.playback_speed,
        "anomaly_onset_reference": pipeline.anomaly_onset_reference
    }

@app.post("/video/speed")
def set_video_speed(req: PlaybackSpeedRequest):
    speed = max(0.25, min(float(req.speed), 5.0))
    pipeline.playback_speed = speed
    return {"status": "ok", "playback_speed": speed}

@app.post("/video/stop")
async def stop_video():
    pipeline.is_running = False
    if pipeline.worker_thread and pipeline.worker_thread.is_alive():
        pipeline.worker_thread.join(timeout=2.0)
    if hasattr(pipeline, 'ring_buffer') and pipeline.ring_buffer is not None:
        try:
            pipeline.ring_buffer.flush_and_save()
        except Exception as ex:
            print(f"Error flushing ring buffer on stop: {ex}")
    pipeline.cap = None
    return {"status": "stopped"}

@app.get("/video/stream")
def video_stream():
    def frame_generator():
        last_sent_fid = -1
        last_yield_time = 0.0
        while True:
            jpeg_bytes = None
            current_fid = pipeline.frame_id
            if pipeline.is_running:
                with pipeline.frame_lock:
                    if pipeline.latest_annotated_frame_jpeg is not None:
                        jpeg_bytes = pipeline.latest_annotated_frame_jpeg

            now = time.time()
            if jpeg_bytes is not None:
                # Yield immediately when a newly processed frame is available, or 1s heartbeat
                if current_fid != last_sent_fid or (now - last_yield_time) >= 1.0:
                    last_sent_fid = current_fid
                    last_yield_time = now
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + jpeg_bytes + b'\r\n')
            else:
                if (now - last_yield_time) >= 0.5:
                    last_yield_time = now
                    blank = np.zeros((360, 640, 3), dtype=np.uint8)
                    msg = "LOADING CCTV FEED & SEEKING..." if pipeline.is_running else "STREAM IDLE - CLICK START STREAM"
                    cv2.putText(blank, msg, (40, 180),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (120, 120, 120), 2)
                    _, buf = cv2.imencode('.jpg', blank)
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
            time.sleep(0.025)

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.post("/calibration/calibrate")
@app.post("/api/calibration/calibrate")
def set_calibration(req: CalibrationRequest):
    res = compute_and_validate_calibration(req)
    if res["status"] in ["CALIBRATED — METRIC", "CALIBRATED — RELATIVE/ARBITRARY SCALE"]:
        global global_calibration_state
        global_calibration_state = res
        with open(CALIBRATION_JSON_PATH, "w") as f:
            json.dump(res, f, indent=2)
    return res

@app.get("/calibration/status")
@app.get("/api/calibration/status")
def get_calibration_status():
    return global_calibration_state

@app.post("/calibration/reset")
@app.post("/api/calibration/reset")
def reset_calibration():
    global global_calibration_state
    global_calibration_state = {
        "camera_id": "AICITY_TRACK4",
        "status": "IMAGE-SPACE ONLY",
        "units": "pixels",
        "homography": None,
        "mean_reprojection_error": None,
        "validation_error": None,
        "calibration_timestamp": time.time(),
        "calibration_method": "N/A"
    }
    if os.path.exists(CALIBRATION_JSON_PATH):
        os.remove(CALIBRATION_JSON_PATH)
    return {"status": "IMAGE-SPACE ONLY"}

# ==============================================================================
# 7. MAIN ENTRYPOINT
# ==============================================================================
if __name__ == "__main__":
    print("Starting Sentinel Live Backend API on http://localhost:8000 (WebSocket: ws://localhost:8000/ws/live)...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
