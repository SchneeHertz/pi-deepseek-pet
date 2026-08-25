# dsh-pet HEVC-alpha 素材流水线

> 独立仓库专用：把主仓库 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（400+ star）的
> 透明 VP9 WebM 批量转换成 Safari 原生支持的 **HEVC-with-Alpha** `.mov`。
>
> ⚠️ 主仓库不跑这个流水线，主仓库也**零改动**——本仓库只是它的素材加工站。

## 为什么需要这个

- **Chrome / Edge / Firefox**：透明 WebM（VP9+alpha）原生支持 ✅
- **Safari**：不支持 WebM alpha（渲染黑底），原生透明只认 **HEVC-with-Alpha**（.mov）；
  而 HEVC-alpha 编码器（`hevc_videotoolbox`）**只有 macOS 有**，Windows/Linux 产不出。
- 本流水线用 **GitHub Actions 免费 macOS runner**（每月免费额度）在云端完成编码，
  无需你自己有 Mac。

## 使用方法（一次性）

### 1. 创建独立仓库

- GitHub 新建一个 public 仓库（例如 `dsh-pet-hevc-pipeline`），
- 把本目录（`.github/`、`scripts/`、`README.md`）push 进去。

### 2. 设定主仓库地址

编辑 `.github/workflows/hevc-alpha.yml`，找到这一行改成你自己的仓库：

```yaml
git clone --depth 1 https://github.com/PC2005-cloud/dsh-pet.git .
```

### 3. 触发流水线

- **手动触发**：仓库 → Actions → hevc-alpha → Run workflow
- 或直接 push 本仓库自动触发（`on: push`）

运行约 5-15 分钟（brew 装 ffmpeg + 97 个视频硬件编码）。

### 4. 下载产物

- Actions 运行完毕后，在运行记录底部的 **Artifacts** 区下载 `dsh-pet-hevc-alpha`，
- 解压得到 `dist/*.mov`（97 个，与 thumb webm 同名）。

### 5. 放回主仓库

```sh
# 在主仓库工作区（本机）执行
cp dist/*.mov dsh-pet/assets/mov/
git add dsh-pet/assets/mov/
git commit -m "feat(assets): Safari HEVC-alpha mov"
```

插件 client 端的 Safari 分支（检测到 Safari/WebKit 时请求 `.mov`，其余浏览器请求
`.webm`）即直接使用这批 mov。

## 目录结构

```
.github/workflows/hevc-alpha.yml   # macOS runner 流水线
scripts/encode_hevc_alpha.sh       # 批量编码 shell（ffmpeg 解码 + swift 编码）
scripts/hevc_alpha_encoder.swift   # HEVC-alpha 编码器（AV Foundation 原生 API）
scripts/check_alpha.py             # 产物 alpha 通道校验（防丢 alpha）
```

## 编码方案（sunkeycn，issue 贡献者已在 Safari 实测）

ffmpeg **只负责解码** webm（`libvpx-vp9` 保留 alpha）→ 输出原始 BGRA 帧 →
swift 程序用 **AVFoundation `AVVideoCodecType.hevcWithAlpha`**（苹果原生 API）
编码为 hvc1 mov——不走 ffmpeg `hevc_videotoolbox` 的像素格式坑，产物为
`Core Media Video` 签名，Safari 原生验证支持。

| 环节 | 做法 | 说明 |
|---|---|---|
| 解码 | `ffmpeg -c:v libvpx-vp9 -i x.webm -f rawvideo -pix_fmt bgra` | **必须 libvpx-vp9**：默认解码器丢 webm alpha |
| 编码 | `hevc_alpha_encoder.swift <out> <w> <h> <fps>` | AVAssetWriter + hevcWithAlpha，苹果原生 |
| alpha 质量 | `kVTCompressionPropertyKey_TargetQualityForAlpha: 0.75` | 0-1，越大越清晰；调大改 swift 源码 |

## 注意

- 素材源是主仓库 `assets/webm/*.webm`（640×360 播放变体）；如需更高清版本，
  可改用主仓库素材链的 `step03/` 透明母版（需自行上传到本仓库）。
- 流水线产物质量与 webm 源一致；若觉得 alpha 边缘不够平滑，把
  `scripts/hevc_alpha_encoder.swift` 里的 `0.75` 改成 `1.0` 重跑一次。
- 免费额度：public 仓库每月 2000 分钟（macOS 按 10 倍折算 ≈ 200 分钟），
  本流水线单次约 15 分钟，够跑十几轮。