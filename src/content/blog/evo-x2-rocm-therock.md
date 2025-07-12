---
title: GMKTec evo x2上で、TheRock版のRocmでllama.cppをビルドして実行
author: amemiya
pubDatetime: 2025-07-13T18:00:00Z
postSlug: gmktec-ryzen-ai-rocm-therock
featured: true
draft: false
tags:
  - ryzenai
  - amd
  - amdgpu
  - gpu
  - npu
  - llm
  - gfx1151
  - ryzen ai max+ 395
  - ubuntu
  - docker
ogImage: ""
description: GMKTECのAI PCで、Therock版のRocmでllama.cppをビルドして実行
canonicalURL: https://blog.tosukui.xyz/posts/gmktec-ryzen-ai-rocm-therock
---

# 目次

# (推奨)ビルド手順 - docker 版

## 必要環境

- ホスト OS は ubuntu24.04 なら動いたが、それ以外の環境は試していない
  - `uname -r` -> 6.11.0-26-generic

以下の URL をクローンし、README 通りにビルドして実行

https://github.com/TOSUKUi/llama.cpp-therock-docker

## ビルド(gfx1151 向け)

```bash
docker build . --tag llama.cpp:therock-dist-linux-gfx1151-7.0.0rc20250710 --build-arg=therock_tarball_filename=therock-dist-linux-gfx1151-7.0.0rc20250710.tar.gz
```

## 実行

### ベンチマーク

- モデルはこちらを利用: https://huggingface.co/TheBloke/Llama-2-7B-GGUF

```bash
docker run -it -p 8080:8080 -v /path/to/models:/app/models --device /dev/kfd --device /dev/dri --security-opt seccomp=unconfined  llama.cpp:therock-dist-linux-gfx1151-7.0.0rc20250710 build/bin/llama-bench -mmp 0 -ngl 99 -m ./models/llama-2-7b.Q4_0.gguf
```

```
# 出力
ggml_cuda_init: GGML_CUDA_FORCE_MMQ:    no
ggml_cuda_init: GGML_CUDA_FORCE_CUBLAS: no
ggml_cuda_init: found 1 ROCm devices:
Device 0: AMD Radeon Graphics, gfx1151 (0x1151), VMM: no, Wave Size: 32

| model                          |       size |     params | backend    | ngl | mmap |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ---: | --------------: | -------------------: |
| llama 7B Q4_0                  |   3.56 GiB |     6.74 B | ROCm       |  99 |    0 |           pp512 |        995.40 ± 2.98 |
| llama 7B Q4_0                  |   3.56 GiB |     6.74 B | ROCm       |  99 |    0 |           tg128 |         47.92 ± 0.04 |

build: 7de5c7ca (5882)
```

### API サーバー

note: `--no-mmap`をつけない場合、システムメモリ以上の VRAM を使えなくなるので、必ずつける

```bash
docker run -it -p 8080:8080 -v /mnt/data/models/llama.cpp/common/:/app/models --device /dev/kfd --device /dev/dri --security-opt seccomp=unconfined llama.cpp:therock-dist-linux-gfx1151-7.0.0rc20250710 build/bin/llama-server --no-mmap -ngl 99 -m ./models/llama-2-7b.Q4_0.gguf --host 0.0.0.0
```

---

<details>
<summary>(非推奨) ビルド手順 - 手動(ubuntu25.04以上必須なので、それ以下のOSの場合は上記のdocker版をまず試して欲しい)</summary>
<div>

# (非推奨) ビルド手順 - 手動(ubuntu25.04 以上必須なので、それ以下の OS の場合は上記の docker 版をまず試して欲しい)

## 必要環境

- ubuntu25.04 である必要があるが、実際に ubuntu25.04 で実行できることを確認していない(docker は少なくとも動いている)
- **ubuntu24.04**の場合は TheRock 版の Rocm を使う時点で実行時に segfault 食らうため、その場合は上記の docker 版のセットアップを行うこと
  - 出力例
  - ```
    ROCBLAS_USE_HIPBLASLT=1 build/bin/llama-bench -mmp 0 -m ./models/llama-2-7b.Q4_0.gguf
    ggml_cuda_init: GGML_CUDA_FORCE_MMQ:    no
    ggml_cuda_init: GGML_CUDA_FORCE_CUBLAS: no
    ggml_cuda_init: found 1 ROCm devices:
    invalid architecture ID received for device 0 AMD Radeon Graphics:   cc 1024.1024
      Device 0: AMD Radeon Graphics,  (0x4000), VMM: no, Wave Size: 0
    Segmentation fault (core dumped)
    ```
- なんか docker 環境では`ubuntu:rolling`(25.04)をベースイメージにしたら動いた(カーネルは共有のはずなのでその上のどこかのスタックが違う？)

## llama.cpp を clone して、作業ディレクトリにする

```bash
git clone https://github.com/ggml-org/llama.cpp llama.cpp-therock #適当に名前変えとく
cd llama.cpp-therock
```

## TheRock 版の Rocm からビルド済みパッケージを持ってくる

github の release ページから `therock-dist-linux-gfx1151-6.4.0` のパターンのものを持ってくる

https://github.com/ROCm/TheRock/releases/tag/nightly-tarball

今回は:`therock-dist-linux-gfx1151-6.4.0rc20250520.tar.gz`を持ってくる

```bash
sudo mkdir -p /opt/rocm-6.4.0rc  # もし違うディレクトリにしたければそこを指定
wget "https://github.com/ROCm/TheRock/releases/download/nightly-tarball/therock-dist-linux-gfx1151-6.4.0rc20250520.tar.gz"
```

解答して、`/opt/rocmに入れる`

```bash
sudo tar -xz -C /opt/rocm-6.4.0rc -f therock-dist-linux-gfx1151-6.4.0rc20250520.tar.gz
rm therock-dist-linux-gfx1151-6.4.0rc20250520.tar.gz # 不要なものは消す
```

## 環境変数を設定

これは何かしらファイルにして source できるようにしておくか、.envrc などで direnv から設定できるようにしておく方が望ましい

```bash
export ROCM_PATH="/opt/rocm-6.5.0rc"
export HIP_PLATFORM="amd"
export HIP_PATH="${ROCM_PATH}"
export HIP_CLANG_PATH="${ROCM_PATH}/llvm/bin"
export HIP_INCLUDE_PATH="${ROCM_PATH}/include"
export HIP_LIB_PATH="${ROCM_PATH}/lib"
export HIP_DEVICE_LIB_PATH="${ROCM_PATH}/lib/llvm/amdgcn/bitcode"
export PATH="${ROCM_PATH}/bin:${HIP_CLANG_PATH}:${PATH}"
export LD_LIBRARY_PATH="${ROCM_PATH}/lib:${ROCM_PATH}/lib64:${ROCM_PATH}/llvm/lib:${LD_LIBRARY_PATH}"
export LIBRARY_PATH="${ROCM_PATH}/lib:${ROCM_PATH}/lib64:${LIBRARY_PATH}"
export CPATH="${HIP_INCLUDE_PATH}:${CPATH}"
export PKG_CONFIG_PATH="${ROCM_PATH}/lib/pkgconfig:${PKG_CONFIG_PATH}"
```

この辺の参考リンク

https://llm-tracker.info/_TOORG/Strix-Halo#system-info

## llama.cpp の一部書き換え

### `ggml/src/ggml-cuda/vendors/hip.h`旧 Rocm 向けのマクロを、TheRock 版の Rocm 向けのマクロに置き換える

これをやらないとビルドが通らない。llama.cpp 自体が対応したら不必要になると思われる。

```bash
sed -i \
  -e 's/#define CUBLAS_COMPUTE_16F HIPBLAS_R_16F/#define CUBLAS_COMPUTE_16F HIPBLAS_COMPUTE_16F/' \
  -e 's/#define CUBLAS_COMPUTE_32F HIPBLAS_R_32F/#define CUBLAS_COMPUTE_32F HIPBLAS_COMPUTE_32F/' \
  -e 's/#define CUBLAS_COMPUTE_32F_FAST_16F HIPBLAS_R_32F/#define CUBLAS_COMPUTE_32F_FAST_16F HIPBLAS_COMPUTE_32F_FAST_16F/' \
  -e 's/#define cublasComputeType_t hipblasDatatype_t/#define cublasComputeType_t hipblasComputeType_t/' \
  -e 's/#define cudaDataType_t hipblasDatatype_t/#define cudaDataType_t hipDataType/' \
  "ggml/src/ggml-cuda/vendors/hip.h"
```

`git diff` の結果が以下のような雰囲気なら大丈夫。

```diff
diff --git a/ggml/src/ggml-cuda/vendors/hip.h b/ggml/src/ggml-cuda/vendors/hip.h
index 184d445f..64d7d1c9 100644
--- a/ggml/src/ggml-cuda/vendors/hip.h
+++ b/ggml/src/ggml-cuda/vendors/hip.h
@@ -146,11 +146,11 @@
 #define cublasComputeType_t hipblasComputeType_t
 #define cudaDataType_t hipDataType
 #else
-#define CUBLAS_COMPUTE_16F HIPBLAS_R_16F
-#define CUBLAS_COMPUTE_32F HIPBLAS_R_32F
-#define CUBLAS_COMPUTE_32F_FAST_16F HIPBLAS_R_32F
-#define cublasComputeType_t hipblasDatatype_t
-#define cudaDataType_t hipblasDatatype_t
+#define CUBLAS_COMPUTE_16F HIPBLAS_COMPUTE_16F
+#define CUBLAS_COMPUTE_32F HIPBLAS_COMPUTE_32F
+#define CUBLAS_COMPUTE_32F_FAST_16F HIPBLAS_COMPUTE_32F_FAST_16F
+#define cublasComputeType_t hipblasComputeType_t
+#define cudaDataType_t hipDataType
 #endif

 #define __CUDA_ARCH__ 1300
```

参考リンク

https://qiita.com/7shi/items/99d5f80a45bf72b693e9

## llama.cpp をビルド

必要そうなものをインストールしておく。他に必要なものがあれば適宜入れる。

```bash
sudo apt install build-essential clang libcurl4-openssl-dev ninja-build
```

ビルド

```bash
mkdir build && cd build \
  && HIPCC="$(/opt/rocm-6.4.0rc/bin/hipconfig -l)/clang" \
  cmake .. \
  -G Ninja \
  -DGGML_HIP=ON \
  -DAMDGPU_TARGETS=gfx1151 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=clang \
  -DCMAKE_CXX_COMPILER=clang++ \
  -DHIP_PLATFORM=amd \
  && cmake --build . --config Release -- -j $(nproc)
```

## テスト

ベンチマークを回す。

ここでは以下のモデルを使ってベンチマークする。

https://huggingface.co/TheBloke/Llama-2-7B-GGUF

- note1: `-mmp 0`をつけない場合、システムメモリ以上のメモリをアロケーションできない
- note2: `ROCBLAS_USE_HIPBLASLT=1`をつけるとパフォーマンスが 20%以上上がるので必須

```bash
ROCBLAS_USE_HIPBLASLT=1 build/bin/llama-bench -mmp 0 -m ./models/llama-2-7b.Q4_0.gguf

ggml_cuda_init: GGML_CUDA_FORCE_MMQ:    no
ggml_cuda_init: GGML_CUDA_FORCE_CUBLAS: no
ggml_cuda_init: found 1 ROCm devices:
  Device 0: AMD Radeon Graphics, gfx1151 (0x1151), VMM: no, Wave Size: 32


build: 7de5c7ca (5882)
```

| model         |     size | params | backend | ngl | mmap |  test |           t/s |
| ------------- | -------: | -----: | ------- | --: | ---: | ----: | ------------: |
| llama 7B Q4_0 | 3.56 GiB | 6.74 B | ROCm    |  99 |    0 | pp512 | 995.40 ± 2.98 |
| llama 7B Q4_0 | 3.56 GiB | 6.74 B | ROCm    |  99 |    0 | tg128 |  47.92 ± 0.04 |

</div>
</details>

---

# ベンチマーク

docker 環境で回したものを記載する

| model                           |      size |   params | backend | ngl | mmap |  test |           t/s |
| ------------------------------- | --------: | -------: | ------- | --: | ---: | ----: | ------------: |
| llama 7B Q4_0                   |  3.56 GiB |   6.74 B | ROCm    |  99 |    0 | pp512 | 994.53 ± 4.16 |
| llama 7B Q4_0                   |  3.56 GiB |   6.74 B | ROCm    |  99 |    0 | tg128 |  47.92 ± 0.02 |
| llama 13B Q4_K - Medium         | 13.54 GiB |  23.57 B | ROCm    |  99 |    0 | pp512 | 335.70 ± 3.06 |
| llama 13B Q4_K - Medium         | 13.54 GiB |  23.57 B | ROCm    |  99 |    0 | tg128 |  13.71 ± 0.01 |
| qwen3moe 30B.A3B Q4_K - Medium  | 16.49 GiB |  30.53 B | ROCm    |  99 |    0 | pp512 | 607.81 ± 5.31 |
| qwen3moe 30B.A3B Q4_K - Medium  | 16.49 GiB |  30.53 B | ROCm    |  99 |    0 | tg128 |  56.55 ± 0.02 |
| qwen3moe 30B.A3B Q8_0           | 33.51 GiB |  30.53 B | ROCm    |  99 |    0 | pp512 | 601.03 ± 4.37 |
| qwen3moe 30B.A3B Q8_0           | 33.51 GiB |  30.53 B | ROCm    |  99 |    0 | tg128 |  37.91 ± 0.00 |
| qwen3 32B Q4_K - Medium         | 18.40 GiB |  32.76 B | ROCm    |  99 |    0 | pp512 | 255.66 ± 2.72 |
| qwen3 32B Q4_K - Medium         | 18.40 GiB |  32.76 B | ROCm    |  99 |    0 | tg128 |   9.91 ± 0.00 |
| qwen3 32B Q8_0                  | 36.76 GiB |  32.76 B | ROCm    |  99 |    0 | pp512 | 246.55 ± 2.16 |
| qwen3 32B Q8_0                  | 36.76 GiB |  32.76 B | ROCm    |  99 |    0 | tg128 |   5.67 ± 0.01 |
| hunyuan-moe A13B Q4_K - Medium  | 45.43 GiB |  80.39 B | ROCm    |  99 |    0 | pp512 | 246.06 ± 3.46 |
| hunyuan-moe A13B Q4_K - Medium  | 45.43 GiB |  80.39 B | ROCm    |  99 |    0 | tg128 |  22.56 ± 0.04 |
| qwen3moe 235B.A22B Q3_K - Small | 94.47 GiB | 235.09 B | ROCm    |  99 |    0 | pp512 | 125.91 ± 2.24 |
| qwen3moe 235B.A22B Q3_K - Small | 94.47 GiB | 235.09 B | ROCm    |  99 |    0 | tg128 |  13.52 ± 0.01 |

# 参考リンク

https://github.com/TOSUKUi/llama.cpp-therock-docker

https://qiita.com/7shi/items/99d5f80a45bf72b693e9

https://github.com/ROCm/TheRock/releases/tag/nightly-tarball

https://llm-tracker.info/_TOORG/Strix-Halo#system-info
