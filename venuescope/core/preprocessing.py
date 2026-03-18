"""
VenueScope — Advanced image preprocessing v4.
- Fisheye/barrel distortion correction
- CLAHE low-light enhancement
- Temporal denoising
- Heat map accumulator
- Frame quality scoring
"""
from __future__ import annotations
import cv2
import numpy as np
from typing import Tuple, List

try:
    _clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
except Exception:
    _clahe = None


def enhance_frame(frame_bgr: np.ndarray, strength: str = "auto") -> np.ndarray:
    if strength == "off" or _clahe is None:
        return frame_bgr
    lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    mean_l = float(l.mean())
    if strength == "always" or (strength == "auto" and mean_l < 85):
        l_eq = _clahe.apply(l)
        return cv2.cvtColor(cv2.merge([l_eq, a, b]), cv2.COLOR_LAB2BGR)
    return frame_bgr


def auto_gamma_correction(frame_bgr: np.ndarray, target_luminance: float = 100.0) -> np.ndarray:
    """
    Automatically adjust gamma to bring average luminance toward target.
    Works on top of CLAHE for extreme darkness (avg < 40).
    """
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    mean_l = float(gray.mean())
    if mean_l < 5:
        return frame_bgr  # completely black frame, skip
    gamma = np.log(target_luminance / 255.0) / np.log(mean_l / 255.0)
    gamma = float(np.clip(gamma, 0.3, 3.0))
    if abs(gamma - 1.0) < 0.05:
        return frame_bgr  # no meaningful change needed
    lut = np.array([min(255, int((i / 255.0) ** gamma * 255))
                    for i in range(256)], dtype=np.uint8)
    return cv2.LUT(frame_bgr, lut)


def upscale_for_detection(frame_bgr: np.ndarray, min_side: int = 720) -> np.ndarray:
    """
    If the shorter dimension is below min_side, upscale using LANCZOS4.
    Gives YOLO more pixels to work with on old SD cameras.
    """
    H, W = frame_bgr.shape[:2]
    if min(H, W) >= min_side:
        return frame_bgr
    scale = min_side / min(H, W)
    new_W = int(W * scale)
    new_H = int(H * scale)
    return cv2.resize(frame_bgr, (new_W, new_H), interpolation=cv2.INTER_LANCZOS4)


def detect_night_mode(frame_bgr: np.ndarray) -> bool:
    """
    Returns True if the frame appears to be a grayscale/IR night-mode feed.
    Detects when R, G, B channels are nearly identical (B&W camera).
    """
    b, g, r = cv2.split(frame_bgr)
    rg_diff = float(np.abs(r.astype(np.int16) - g.astype(np.int16)).mean())
    rb_diff = float(np.abs(r.astype(np.int16) - b.astype(np.int16)).mean())
    return (rg_diff < 6.0 and rb_diff < 6.0)


def night_mode_enhance(frame_bgr: np.ndarray) -> np.ndarray:
    """
    Enhanced processing for IR/night-mode (grayscale) cameras.
    Converts to proper grayscale, enhances, returns as 3-channel BGR for YOLO.
    """
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    # Aggressive CLAHE for night footage
    clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(4, 4))
    gray = clahe.apply(gray)
    # Sharpen
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
    gray = cv2.filter2D(gray, -1, kernel)
    gray = np.clip(gray, 0, 255).astype(np.uint8)
    # Return as 3-channel so YOLO can process it normally
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def enhance_for_detection(frame_bgr: np.ndarray, strength: str = "off") -> np.ndarray:
    """
    Apply a full enhancement pipeline optimised for YOLO detection on bad cameras.
    strength: 'off' | 'light' | 'strong'
    - light: CLAHE + mild sharpen
    - strong: gamma correction + CLAHE + bilateral denoise + unsharp mask
    """
    if strength == "off":
        return frame_bgr

    # Step 0 (strong only): Auto gamma to brighten very dark footage
    if strength == "strong":
        frame_bgr = auto_gamma_correction(frame_bgr, target_luminance=100.0)

    # Step 1: CLAHE on luminance channel
    lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clip = 3.0 if strength == "strong" else 2.0
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    l = clahe.apply(l)
    frame_bgr = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

    # Step 2: Bilateral filter to reduce noise while preserving edges
    if strength == "strong":
        frame_bgr = cv2.bilateralFilter(frame_bgr, d=5, sigmaColor=50, sigmaSpace=50)

    # Step 3: Unsharp mask for sharpening
    sigma = 1.0 if strength == "light" else 1.5
    amount = 0.8 if strength == "light" else 1.5
    blurred = cv2.GaussianBlur(frame_bgr, (0, 0), sigma)
    frame_bgr = cv2.addWeighted(frame_bgr, 1 + amount, blurred, -amount, 0)

    return frame_bgr


def build_dewarp_maps(W: int, H: int, strength: float = 0.4) -> Tuple[np.ndarray, np.ndarray]:
    k1 = -strength * 0.5
    k2 =  strength * 0.05
    cx, cy = W / 2.0, H / 2.0
    fx = fy = max(W, H) * 0.85
    K    = np.array([[fx,0,cx],[0,fy,cy],[0,0,1]], dtype=np.float64)
    dist = np.array([k1,k2,0,0,0], dtype=np.float64)
    new_K, _ = cv2.getOptimalNewCameraMatrix(K, dist, (W,H), 1, (W,H))
    map1, map2 = cv2.initUndistortRectifyMap(K, dist, None, new_K, (W,H), cv2.CV_32FC1)
    return map1, map2


def dewarp_frame(frame: np.ndarray, map1: np.ndarray, map2: np.ndarray) -> np.ndarray:
    return cv2.remap(frame, map1, map2, cv2.INTER_LINEAR)


def auto_detect_distortion(frame_bgr: np.ndarray) -> float:
    gray  = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, 80, minLineLength=80, maxLineGap=10)
    if lines is None or len(lines) < 10:
        return 0.0
    H, W = frame_bgr.shape[:2]
    cx, cy = W/2, H/2
    curvatures = []
    for line in lines:
        x1,y1,x2,y2 = line[0]
        mx,my = (x1+x2)/2,(y1+y2)/2
        d = np.sqrt((mx-cx)**2+(my-cy)**2)/np.sqrt(cx**2+cy**2)
        curvatures.append(d)
    edge_lines = sum(1 for c in curvatures if c > 0.6)
    return min(1.0, edge_lines/len(curvatures)*1.5) if curvatures else 0.0


class TemporalDenoiser:
    def __init__(self, n: int = 3, alpha: float = 0.6):
        self.n = n; self.alpha = alpha; self._buf: List[np.ndarray] = []

    def process(self, frame: np.ndarray) -> np.ndarray:
        self._buf.append(frame.astype(np.float32))
        if len(self._buf) > self.n: self._buf.pop(0)
        if len(self._buf) == 1: return frame
        blended = self._buf[-1].copy()
        for prev in reversed(self._buf[:-1]):
            blended = blended*self.alpha + prev*(1-self.alpha)
        return np.clip(blended,0,255).astype(np.uint8)


class HeatMapAccumulator:
    def __init__(self, W: int, H: int, scale: float = 0.25):
        self.scale = scale
        self.W = int(W*scale); self.H = int(H*scale)
        self._map = np.zeros((self.H, self.W), dtype=np.float32)

    def update(self, centroids: np.ndarray):
        for cx,cy in centroids:
            px,py = int(cx*self.scale), int(cy*self.scale)
            if 0<=px<self.W and 0<=py<self.H:
                cv2.circle(self._map,(px,py),8,1.0,-1)

    def render(self, orig_W: int, orig_H: int) -> np.ndarray:
        if self._map.max() == 0:
            return np.zeros((orig_H,orig_W,3),dtype=np.uint8)
        blurred = cv2.GaussianBlur(self._map,(21,21),0)
        norm    = (blurred/blurred.max()*255).astype(np.uint8)
        colored = cv2.applyColorMap(norm, cv2.COLORMAP_JET)
        resized = cv2.resize(colored,(orig_W,orig_H))
        mask    = cv2.resize((norm>5).astype(np.uint8)*255,(orig_W,orig_H))
        result  = resized.copy(); result[mask==0]=0
        return result

    def overlay_on_frame(self, frame_bgr: np.ndarray, alpha: float = 0.55) -> np.ndarray:
        H,W = frame_bgr.shape[:2]
        heat = self.render(W,H); mask = heat.any(axis=2); out = frame_bgr.copy()
        out[mask] = cv2.addWeighted(frame_bgr,1-alpha,heat,alpha,0)[mask]
        return out

    def to_png_bytes(self, orig_W: int, orig_H: int) -> bytes:
        img = self.render(orig_W, orig_H)
        _, buf = cv2.imencode(".png", img)
        return buf.tobytes()


def frame_quality_score(frame_bgr: np.ndarray) -> dict:
    gray     = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    mean_lum = float(gray.mean())
    blur     = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    H, W     = frame_bgr.shape[:2]
    dist_est = auto_detect_distortion(frame_bgr)
    warnings = []
    if mean_lum < 35:
        warnings.append("🔴 Very dark — enable 'Always' CLAHE + temporal denoising")
    elif mean_lum < 65:
        warnings.append("🟡 Low light — CLAHE auto-enhancement will activate")
    if blur < 40:
        warnings.append("🔴 Very blurry — camera needs refocusing")
    elif blur < 100:
        warnings.append("🟡 Moderate blur — higher bitrate recording recommended")
    if W < 640 or H < 360:
        warnings.append(f"🔴 Low resolution ({W}×{H}) — 720p minimum recommended")
    if dist_est > 0.4:
        warnings.append(f"🟡 Fisheye distortion detected ({dist_est:.2f}) — enable dewarping")
    grade = "🟢 Good" if not warnings else ("🟡 Fair" if len(warnings)==1 else "🔴 Poor")
    return {"grade":grade,"mean_luminance":round(mean_lum,1),"blur_score":round(blur,1),
            "resolution":f"{W}×{H}","distortion_est":round(dist_est,3),
            "warnings":warnings,"ok":len(warnings)==0}


def draw_counting_lines(frame_rgb, lines, ignore_zones=None):
    H,W = frame_rgb.shape[:2]; canvas = frame_rgb.copy()
    COLORS=[(255,100,30),(30,200,100),(100,150,255),(255,220,50),(220,80,200),(80,220,220)]
    if ignore_zones:
        overlay=canvas.copy()
        for z in ignore_zones:
            pts=np.array([(int(p[0]*W),int(p[1]*H)) for p in z["polygon"]],np.int32)
            cv2.fillPoly(overlay,[pts],(80,0,0))
            cv2.polylines(canvas,[pts.reshape(-1,1,2)],True,(200,50,50),2)
            if pts.size:
                cv2.putText(canvas,f"STAFF: {z.get('label','')}", tuple(pts[0]),
                            cv2.FONT_HERSHEY_SIMPLEX,0.5,(200,50,50),1)
        canvas=cv2.addWeighted(overlay,0.25,canvas,0.75,0)
    for i,line in enumerate(lines):
        color=COLORS[i%len(COLORS)]
        p1=(int(line["p1"][0]*W),int(line["p1"][1]*H))
        p2=(int(line["p2"][0]*W),int(line["p2"][1]*H))
        cv2.line(canvas,p1,p2,color,3)
        mid=((p1[0]+p2[0])//2,(p1[1]+p2[1])//2)
        dx=p2[0]-p1[0]; dy=p2[1]-p1[1]
        perp=(-dy,dx); mag=max((perp[0]**2+perp[1]**2)**0.5,1)
        side=line.get("entry_side",-1)
        ae=(int(mid[0]+side*perp[0]/mag*40),int(mid[1]+side*perp[1]/mag*40))
        cv2.arrowedLine(canvas,mid,ae,color,2,tipLength=0.4)
        cv2.putText(canvas,line.get("label",f"#{i+1}"),(p1[0]+4,p1[1]-8),
                    cv2.FONT_HERSHEY_SIMPLEX,0.6,color,2)
        [cv2.circle(canvas,p,5,color,-1) for p in [p1,p2]]
    return canvas


def draw_bar_zones(frame_rgb, stations, ignore_zones=None):
    H,W=frame_rgb.shape[:2]; canvas=frame_rgb.copy()
    COLORS=[(255,100,0),(0,200,100),(200,100,255),(255,220,0),(0,180,255)]
    if ignore_zones:
        overlay=canvas.copy()
        for z in ignore_zones:
            pts=np.array([(int(p[0]*W),int(p[1]*H)) for p in z["polygon"]],np.int32)
            cv2.fillPoly(overlay,[pts],(80,0,0))
            cv2.polylines(canvas,[pts.reshape(-1,1,2)],True,(200,50,50),2)
        canvas=cv2.addWeighted(overlay,0.25,canvas,0.75,0)
    for idx,st in enumerate(stations):
        c=COLORS[idx%len(COLORS)]
        pts=np.array([(int(p[0]*W),int(p[1]*H)) for p in st.polygon],np.int32)
        p1_px=(int(st.bar_line_p1[0]*W),int(st.bar_line_p1[1]*H))
        p2_px=(int(st.bar_line_p2[0]*W),int(st.bar_line_p2[1]*H))
        cv2.polylines(canvas,[pts.reshape(-1,1,2)],True,c,2)
        cv2.line(canvas,p1_px,p2_px,(0,255,255),3)
        if pts.size:
            cv2.putText(canvas,st.label,tuple(pts[0]),cv2.FONT_HERSHEY_SIMPLEX,0.7,c,2)
    return canvas
