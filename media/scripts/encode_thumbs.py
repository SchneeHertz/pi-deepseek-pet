"""Transcode step03 masters into Pi DeepSeek Pet's 640x360 WebM runtime assets.

素材处理链的第 4 步（转码）：把归一化后的透明母版（media/step03/）
直接写入 assets/animations/webm/，供 Pi DeepSeek Pet 桌面应用运行时使用。

完整处理链（与 crop_step01.py / chroma_step02.py / normalize_step03.py 同级）：
  step01（原始视频）→ crop_step01.py → chroma_step02.py（绿幕抠像）
  → step02（透明 810x720）→ normalize_step03.py（归一化 1200x1200 统一站立）
  → step03（母版）→ 本脚本 → assets/animations/webm（640x360 播放变体）

assets/animations/webm 是素材处理链的最终输出和桌面安装包的 extraResources 输入。

为什么需要转码：
- 播放时宠物窗口较小，640×360 已足够清晰，母版分辨率属于运行时冗余
- 运行素材位于 asar 外，便于 Range 读取并减少切换开销
- 播放更省内存、切换更快

双轨设计：
- runtime（本脚本产物，640x360）→ assets/animations/webm/，由 Electron 运行时播放
- full（step03 原始 1200x1200）→ 不进 npm 包，发布到 GitHub Releases 存档
"""

from __future__ import annotations

import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "step03"
OUT = ROOT.parent / "assets" / "animations" / "webm"
# 统一使用工作区自带的 ffmpeg（素材处理链零第三方依赖）
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")
FFPROBE = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffprobe.exe")

PARALLEL = 4
# 转码参数（调这里改画质/分辨率）
TARGET_W = 640    # thumb 宽度（与 2160x1215 母版同 16:9 比例）
TARGET_H = 360    # thumb 高度
CRF = 40       # VP9 质量参数（0-63，越小越清晰越大；40 偏轻，透明区域省码）
FPS = 24       # 帧率（与母版一致，保持动作节奏）


def convert_video(src: Path, dst: Path) -> None:
    """转码单个视频。

    注意：
    - 解码端必须指定 -c:v libvpx-vp9（libvpx 解码才能保留 VP9 alpha，与
      normalize_step03.py 一致）；ffmpeg 自动选解码器会丢 alpha 导致黑底。
    - scale 滤镜默认也会丢 alpha，需 format=yuva420p 强制保留。
    """
    cmd = [
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-c:v",
        "libvpx-vp9",  # 关键：libvpx 解码才能保留 VP9 alpha
        "-i",
        str(src),
        "-vf",
        f"scale={TARGET_W}:{TARGET_H},format=yuva420p",
        "-c:v",
        "libvpx-vp9",  # VP9 编码（WebM 标准）
        "-crf",
        str(CRF),
        "-b:v",
        "0",  # 恒定质量模式（CRF）
        "-row-mt",
        "1",  # 多行并行（加速编码）
        "-r",
        str(FPS),
        "-an",  # 丢弃音轨（动画无声音，省体积）
        str(dst),
    ]
    result = subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())


def _is_valid(dst: Path, src: Path, min_size: int = 20_000) -> bool:
    """断点续跑完整性检查：存在、够大、不比源旧、且能被 ffprobe 读到视频流。"""
    if not dst.exists() or dst.stat().st_size <= min_size:
        return False
    if dst.stat().st_mtime < src.stat().st_mtime:
        return False
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name",
                        "-of", "csv=p=0", str(dst)], capture_output=True)
    return bool(r.stdout.strip())


def _process_one(video: Path) -> tuple[str, int, int, bool]:
    """处理单个视频（worker 函数），返回 (名字, 源大小, 输出大小, 是否跳过)。"""
    src_size = video.stat().st_size
    dst = OUT / video.name
    if _is_valid(dst, video):
        return video.name, src_size, 0, True
    convert_video(video, dst)
    return video.name, src_size, dst.stat().st_size, False


def main() -> int:
    OUT.mkdir(exist_ok=True)
    videos = sorted(SRC.glob("*.webm"))
    if not videos:
        print(f"No WebM masters found in {SRC}")
        return 1

    src_total = 0
    out_total = 0
    total = len(videos)
    with ProcessPoolExecutor(max_workers=PARALLEL) as ex:
        for index, (name, src_size, out_size, skipped) in enumerate(ex.map(_process_one, videos), start=1):
            src_total += src_size
            out_total += out_size
            if skipped:
                print(f"[{index}/{total}] SKIP {name} (already encoded)", flush=True)
            else:
                print(f"[{index}/{total}] {name}  {src_size / 1e6:.1f}MB -> {out_size / 1e6:.1f}MB", flush=True)

    print(f"\n=== summary ===")
    print(f"masters: {total}")
    print(f"source total: {src_total / 1e6:.1f}MB")
    print(f"thumb total: {out_total / 1e6:.1f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
