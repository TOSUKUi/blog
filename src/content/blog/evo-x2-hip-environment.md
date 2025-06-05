---
title: GMKTec evo x2上で、rocm(hip)でllama.cppをビルドして実行する
author: amemiya
pubDatetime: 2025-06-04T18:00:00Z
postSlug: gmktec-ryzen-ai-rocm-hip-setup
featured: true
draft: false
tags:
  - ryzenai
  - amd
  - amdgpu
  - gpu
  - npu
  - ll
ogImage: ""
description: GMKTEcのAI PCのrocm(hip)環境をセットアップしてllama.cppを動かす記事
canonicalURL: https://blog.tosukui.xyz/posts/gmktec-ryzen-ai-rocm-hip-setup
---

# はじめに

- llama.cpp を rocm6.4.0 でビルドし、実行することがゴール
- **2025 年 6 月頭時点で ROCm6.4.1 を使わないの？**
  - 色々ごちゃごちゃしてたので正確な検証はできていないが、llama.cpp の動作が異常に遅かったので 6.4.0 にした
- GPU メモリがなぜか 32GB くらいまでしか使えなかった。これ以上のモデルを動かそうとするとメモリあるのに怒られる

  - システムメモリの容量を超えるとメモリエラーになる場合があるらしい

- [こちらの記事](https://blog.tosukui.xyz/posts/gmktec-ryzen-ai-rocm-setup)では環境構築をできず vulkan に逃げた

# ベンチマークの結果サマリー

- Qwen3 30B の場合は
  - prompt processing は明らかに速くなった(200%以上早い)
  - `token generation`は遅くなった(20%くらい遅い)
- Llama7 Q4 の場合
  - 何もかも遅くなった
- GPU メモリの使える量が vulkan 比較で少ない。vulkan だと(96GB + 16GB(GTT))分の 112GB 使えていたっぽいが、今の所 96GB しかアロケーションできずより大きいモデルの同条件テストができない
  - `GGML_CUDA_ENABLE_UNIFIED_MEMORY=1`はテスト済みだがたぶん違った

# 全体手順

- [はじめに](#はじめに)
- [ベンチマークの結果サマリー](#ベンチマークの結果サマリー)
- [全体手順](#全体手順)
- [環境](#環境)
  - [1. rocm6.4.0 をインストール(インストールしてない人向け)](#1-rocm640-をインストールインストールしてない人向け)
    - [手順](#手順)
    - [1.amdgpu-install をインストール](#1amdgpu-install-をインストール)
    - [2.再起動してドライバを反映](#2再起動してドライバを反映)
    - [3. rocm インストール](#3-rocm-インストール)
      - [リポジトリの登録](#リポジトリの登録)
    - [パッケージの追加](#パッケージの追加)
    - [インストール](#インストール)
    - [インストール後](#インストール後)
      - [確認](#確認)
  - [llama.cpp のビルド](#llamacpp-のビルド)
    - [llama.cpp をクローンしておく](#llamacpp-をクローンしておく)
    - [rocWMMA をインストール](#rocwmma-をインストール)
      - [rocWMMA とは](#rocwmma-とは)
    - [llama.cpp をビルド](#llamacpp-をビルド)
      - [1. llama.cpp の`ggml/src/ggml-cuda/fattn-wmma-f16.cu`を無効化](#1-llamacpp-のggmlsrcggml-cudafattn-wmma-f16cuを無効化)
      - [2. ビルド](#2-ビルド)
  - [llama.cpp を動かす](#llamacpp-を動かす)
    - [rocBLAS を gfx1151 対応バージョンでビルド](#rocblas-を-gfx1151-対応バージョンでビルド)
      - [rocBLAS とは？](#rocblas-とは)
    - [1. rocBLAS を gfx1151 向けにビルド\&インストール](#1-rocblas-を-gfx1151-向けにビルドインストール)
      - [実行時に必要な環境変数をエクスポートする](#実行時に必要な環境変数をエクスポートする)
    - [llama.cpp を動かす](#llamacpp-を動かす-1)
  - [llama-bench を実行](#llama-bench-を実行)
    - [結果](#結果)
      - [Qwen30B の場合](#qwen30b-の場合)
      - [LLama2 7B の場合](#llama2-7b-の場合)
  - [参考リンク](#参考リンク)

# 環境

- ubuntu24.04
  - kernel
  ```bash
  $ uname -a
  Linux amd-ai-worker1 6.11.0-26-generic #26~24.04.1-Ubuntu SMP PREEMPT_DYNAMIC Thu Apr 17 19:20:47 UTC 2 x86_64 x86_64 x86_64 GNU/Linux
  ```

## 1. rocm6.4.0 をインストール(インストールしてない人向け)

まず稼働に必要な ROCm をインストールする。

ここでは AMD から提供されている`amdgpu-install`を使った枠組みを使う

### 手順

### 1.amdgpu-install をインストール

```
wget https://repo.radeon.com/amdgpu-install/6.4.1/ubuntu/noble/amdgpu-install_6.4.60401-1_all.deb
sudo apt install ./amdgpu-install_6.4.60401-1_all.deb
sudo apt update
sudo apt install "linux-headers-$(uname -r)" "linux-modules-extra-$(uname -r)"
sudo apt install amdgpu-dkms #ドライバインストール
```

### 2.再起動してドライバを反映

### 3. rocm インストール

デフォルトだと、2025 年 6 月 3 日現在では、rocm6.4.1 がインストールされてしまう

[公式ドキュメント](https://rocm.docs.amd.com/projects/install-on-linux/en/latest/install/install-methods/multi-version-install/multi-version-install-ubuntu.html)

#### リポジトリの登録

rocm のリポジトリキー追加

```
wget https://repo.radeon.com/rocm/rocm.gpg.key -O - | \
gpg --dearmor | sudo tee /etc/apt/keyrings/rocm.gpg > /dev/null
```

### パッケージの追加

```bash
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/rocm.gpg] https://repo.radeon.com/amdgpu/6.4.1/ubuntu noble main" \
    | sudo tee /etc/apt/sources.list.d/amdgpu.list

# Note: There is NO trailing .0 in the patch version when registering repositories
for ver in 6.4.1 6.4; do
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/rocm.gpg] https://repo.radeon.com/rocm/apt/$ver noble main" \
    | sudo tee --append /etc/apt/sources.list.d/rocm.list
done
echo -e 'Package: *\nPin: release o=repo.radeon.com\nPin-Priority: 600' \
    | sudo tee /etc/apt/preferences.d/rocm-pin-600
sudo apt update
```

### インストール

```
sudo apt install rocm6.4.0
```

### インストール後

ROCm アプリケーションが shared objects(.so ファイル)を見つけられるようシステムリンカーを設定

```bash
sudo tee --append /etc/ld.so.conf.d/rocm.conf <<EOF
/opt/rocm/lib
/opt/rocm/lib64
EOF
sudo ldconfig
```

#### 確認

```bash
# rocm* および hip*があるか確認
apt list --installed

# パスが通っているか確認 これが走ったらインストールできているはず
rocminfo
clinfo
```

ちなみに rocm のライブラリは`/opt/rocm`以下に全部入っているので、気になったらそこをみると良い

## llama.cpp のビルド

- この後の作業は[llm-tracker/strix-halo](https://llm-tracker.info/_TOORG/Strix-Halo)が非常に参考になるので、参考に進めていく
- llm-tracker は AMD GPU 系の情報源としてかなり優秀

### llama.cpp をクローンしておく

```bash
git clone https://github.com/ggml-org/llama.cpp llama.cpp-rocm # rocm向けっぽい名前にしておく
cd llama.cpp-rocm # ここで作業する
```

### rocWMMA をインストール

#### rocWMMA とは

- AMD の最新 GPU 上で混合精度の行列積和演算を高速化する C++ヘッダーライブラリ
- 今回の llama.cpp の動作も速くなるとの噂

```bash
# llama.cpp-rocm内で作業。rocm6.4対応のタグを指定しておく
git clone -b release/rocm-rel-6.4 https://github.com/ROCmSoftwarePlatform/rocWMMA.git

# ROCmアプリケーションがビルドに使えるように環境変数にパスを指定
# ビルド時だけなので今後指定する必要はないと思う
export HIPCC_COMPILE_FLAGS_APPEND="-I$HOME/llama.cpp/rocWMMA/library/include"
```

ディレクトリだけみるとこんな感じになっているはず

```
.
├── ci
├── cmake
├── common
├── docs
├── examples
├── ggml
├── gguf-py
├── grammars
├── include
├── licenses
├── media
├── models
├── pocs
├── prompts
├── requirements
├── **rocWMMA**
...
└── vendor
```

### llama.cpp をビルド

#### 1. llama.cpp の`ggml/src/ggml-cuda/fattn-wmma-f16.cu`を無効化

ほぼ使われていないにもかかわらず、ビルドエラーを起こすので対策する

既存のコードを削除 OR コメントアウトして、以下のコードで置き換える

```c
// ggml/src/ggml-cuda/fattn-wmma-f16.cu (replacement)
#include "common.cuh"
#include "fattn-common.cuh"

extern "C" __global__ void flash_attn_ext_f16_stub() { /* noop */ }

void ggml_cuda_flash_attn_ext_wmma_f16(ggml_backend_cuda_context & ctx,
                                       ggml_tensor * dst) {
    GGML_UNUSED(ctx);
    GGML_UNUSED(dst);
}
```

#### 2. ビルド

- DGGML_HIP_ROCWMMA_FATTN フラグを有効化すると rocWMMA を有効化してくれる

```bash
HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" cmake -S . -B build -DGGML_HIP_ROCWMMA_FATTN=ON -DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151 -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release -- -j 16
```

問題が起きたらパスがちゃんと通っているか、環境変数がおかしいかなど確認

## llama.cpp を動かす

実はこのまま`bin/build/llama-server`を走らせるとコケるので、まずはその準備をする

### rocBLAS を gfx1151 対応バージョンでビルド

コケる理由は、ROCm を構成するスタックの一部である rocBLAS に、strix halo に搭載される GPU である gfx1151 向けのプリビルドパッケージがないため

#### rocBLAS とは？

- Basic Linear Algebra Subprograms (BLAS)
- AMD GPU に最適化された線形代数プログラム群
- ROCm のスタックに似た名前の hipBLAS というのがあるが、こちらは cuBLAS とか rocBLAS とかのライブラリを統一のインターフェースでアクセスできるようにした中間ライブラリだった

### 1. rocBLAS を gfx1151 向けにビルド&インストール

```bash
# llama.cpp-rocmディレクトリ内で作業
git clone -b release/rocm-rel-6.4 https://github.com/ROCm/rocBLAS
cd rocBLAS
# インストール時に-dとか-iとか指定できるが、-i(install)を指定するとaptで入れた側のrocm環境全体に影響が出るので、指定しない
# 詳しくはドキュメントを参照 https://rocm.docs.amd.com/projects/rocBLAS/en/latest/install/Linux_Install_Guide.html#build-library-dependencies-library
HIP_PLATFORM=amd ./install.sh -d -j$(nproc) -a gfx1151
# それなりの時間がかかる
```

#### 実行時に必要な環境変数をエクスポートする

```
export ROCBLAS_TENSILE_LIBPATH="$HOME/work/llama.cpp-rocm/rocBLAS/build/release/rocblas-install/lib/rocblas/library"
export LD_LIBRARY_PATH="$HOME/work/llama.cpp-rocm/rocBLAS/build/release/rocblas-install/lib:$LD_LIBRARY_PATH"
```

- `ROCBLAS_TENSILE_LIBPATH`は、rocBLAS に入っているライブラリを明示的に rocm アプリケーションに伝える変数(公式ドキュメントにもそう書いてある)
- `LD_LIBRARY_PATH`は、実行時には入らないが今後入れるであろう`hipBLASLt`のビルドに必要
- いずれの環境変数も、何かしら一発で設定できるような仕組みにしておいた方がいいが、.bashrc とかに書くのは toomuch な気がする

### llama.cpp を動かす

インタラクティブなチャットが開いたらゴールです。

```bash
build/bin/llama-server --host 0.0.0.0 --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 -ngl 93 --model /mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf -c 10000
```

ちなみに、なぜか 20GB を超えるモデルになると以下のように out of memory で怒られる

序盤に`98148 MiB free`って書いてあるやんけ

```bash
@amd-ai-worker1:~/work/llama.cpp-rocm$ GGML_CUDA_ENABLE_UNIFIED_MEMORY=1 build/bin/llama-server --host 0.0.0.0 --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 -ngl 93 --model /mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf -c 32000
ggml_cuda_init: GGML_CUDA_FORCE_MMQ:    no
ggml_cuda_init: GGML_CUDA_FORCE_CUBLAS: no
ggml_cuda_init: found 1 ROCm devices:
  Device 0: AMD Radeon Graphics, gfx1151 (0x1151), VMM: no, Wave Size: 32
build: 5581 (71e74a3a) with cc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0 for x86_64-linux-gnu
system info: n_threads = 16, n_threads_batch = 16, total_threads = 32

system_info: n_threads = 16 (n_threads_batch = 16) / 32 | ROCm : NO_VMM = 1 | PEER_MAX_BATCH_SIZE = 128 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX_VNNI = 1 | AVX2 = 1 | F16C = 1 | FMA = 1 | BMI2 = 1 | AVX512 = 1 | AVX512_VBMI = 1 | AVX512_VNNI = 1 | AVX512_BF16 = 1 | LLAMAFILE = 1 | OPENMP = 1 | AARCH64_REPACK = 1 |

main: binding port with default address family
main: HTTP server is listening, hostname: 0.0.0.0, port: 8080, http threads: 31
main: loading model
srv    load_model: loading model '/mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf'
llama_model_load_from_file_impl: using device ROCm0 (AMD Radeon Graphics) - 98148 MiB free
llama_model_loader: loaded meta data with 39 key-value pairs and 579 tensors from /mnt/data

....

ggml_backend_cuda_buffer_type_alloc_buffer: allocating 33723.51 MiB on device 0: cudaMalloc failed: out of memory
alloc_tensor_range: failed to allocate ROCm0 buffer of size 35361661056
llama_model_load: error loading model: unable to allocate ROCm0 buffer
llama_model_load_from_file_impl: failed to load model
common_init_from_params: failed to load model '/mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf'
srv    load_model: failed to load model, '/mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf'
srv    operator(): operator(): cleaning up before exit...
main: exiting due to model loading error
```

## llama-bench を実行

ためしにベンチマークをとってみる

```
amd-ai-worker1:~/work/llama.cpp-rocm$ build/bin/llama-bench -b 1280,640,320,160,120,0 -ngl 99 --model /mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-UD-Q4_K_XL.gguf
ggml_cuda_init: GGML_CUDA_FORCE_MMQ:    no
ggml_cuda_init: GGML_CUDA_FORCE_CUBLAS: no
ggml_cuda_init: found 1 ROCm devices:
  Device 0: AMD Radeon Graphics, gfx1151 (0x1151), VMM: no, Wave Size: 32
```

| model                          |      size |  params | backend | ngl | n_batch |  test |           t/s |
| ------------------------------ | --------: | ------: | ------- | --: | ------: | ----: | ------------: |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |    1280 | pp512 | 413.42 ± 2.21 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |    1280 | tg128 |  56.25 ± 0.03 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |     640 | pp512 | 389.45 ± 1.05 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |     640 | tg128 |  56.09 ± 0.22 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |     320 | pp512 | 365.22 ± 1.23 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |     320 | tg128 |  56.21 ± 0.04 |

### 結果

#### Qwen30B の場合

- バッチサイズ 320 を超えたら pp/s に大きく変化はなかった。
- vulkan の結果よりかなり pp/s が良い

  - vulkan のベストが 170/s 程度なので、これに比べて 120%程度の向上がある。これは長いコンテキストの処理にかなり有利だ
  - 反面 tg/s が少し悪いのでここは今後の改善に期待

  | model                          |      size |  params | backend | ngl | n_batch |  test |           t/s |
  | ------------------------------ | --------: | ------: | ------- | --: | ------: | ----: | ------------: |
  | qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     120 | pp512 | 169.14 ± 1.98 |
  | qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     120 | tg128 |  72.05 ± 0.03 |
  | qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |    1280 | pp512 | 413.42 ± 2.21 |
  | qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | ROCm    |  99 |    1280 | tg128 |  56.25 ± 0.03 |

#### LLama2 7B の場合

- こっちは何もかも遅くなっちまった！
  | model | size | params | backend | ngl | n_batch | test | t/s |
  | ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | --------------: | -------------------: |
  | llama 7B Q4_0 | 3.56 GiB | 6.74 B | Vulkan | 99 | 120 | pp512 | 744.30 ± 28.18 |
  | llama 7B Q4_0 | 3.56 GiB | 6.74 B | Vulkan | 99 | 120 | tg128 | 49.87 ± 0.35 |
  | llama 7B Q4_0 | 3.56 GiB | 6.74 B | ROCm | 99 | 2560 | pp512 | 329.80 ± 10.52 |
  | llama 7B Q4_0 | 3.56 GiB | 6.74 B | ROCm | 99 | 2560 | tg128 | 47.94 ± 0.07 |

## 参考リンク

- amdgpu-install 関連: https://rocm.docs.amd.com/projects/install-on-linux/en/latest/install/quick-start.html
- rocWMMA 関連: https://llm-tracker.info/_TOORG/Strix-Halo#building-rocwmma-version
- rocBLAS のビルド: https://llm-tracker.info/_TOORG/Strix-Halo#improving-performance
