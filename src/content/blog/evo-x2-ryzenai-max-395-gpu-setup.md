---
title: GMKTecのAI PCのGPUセットアップする。RyzenAI Max+ 395
author: amemiya
pubDatetime: 2025-05-16T10:00:00Z
postSlug: gmktec-ryzen-ai-pc-setup
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
description: GMKTEcのAI PCをセットアップして、GPUのベンチマークを取ってみた
canonicalURL: https://blog.tosukui.xyz/posts/gmktec-ryzen-ai-pc-setup
---

- [概要](#概要)
- [目標](#目標)
- [GMKTEC Evo X2 の外観](#gmktec-evo-x2の外観)
- [HIP を使った環境のセットアップ開始](#hipを使った環境のセットアップ開始)
  - [NPU はどこいった？](#npuはどこいった)
  - [llama.cpp を動かす](#llamacppを動かす)
- [(vulkan に)切り替えていく](#vulkanに切り替えていく)
- [vulkan 環境の各 LLM モデルのベンチマーク結果](#vulkan環境の各llmモデルのベンチマーク結果)
  - [Qwen3-235B-A22B_Q3_K_S(95GB)](#qwen3-235b-a22b_q3_k_s95gb)
  - [その他主要モデル](#その他主要モデル)
- [batch size ごとに prompt processing の速度を検証](#batch-sizeごとにprompt-processingの速度を検証)
  - [ちょっと長いコンテキストの場合](#ちょっと長いコンテキストの場合)
  - [batch size 120 でそれぞれの LLM の速度検証](#batch-size-120でそれぞれのllmの速度検証)
- [失敗例](#失敗例)

# 概要

GMKTec Evo X2 を購入したが、amdgpu のセットアップが初めてなのでそのあたりの作業のメモがてらこの記事を書いた。

また、人々が欲している LLM のベンチマークについても詳しく調査する予定(追記予定)

# 目標

AMD の GPU を使って llama.cpp を動かす！
あと、NPU は linux で使えるのかというところについても最善を尽くす予定。

なお、以下のサイトによると vulkan が基本的に速いらしいが、
ロングコンテキストになると hip + rocwmma が早くなるらしいぞ

https://llm-tracker.info/_TOORG/Strix-Halo

# GMKTEC Evo X2 の外観

# HIP を使った環境のセットアップ開始

下記の AMDGPU installer を使うとアホの顔しててもドライバのインストールをしてくれる。なかなかやるやん。
https://rocm.docs.amd.com/projects/install-on-linux/en/develop/install/amdgpu-install.html

amdgpu installer をインストールするためにリポジトリを追加

```bash
sudo apt update
wget https://repo.radeon.com/amdgpu-install/6.4/ubuntu/noble/amdgpu-install_6.4.60400-1_all.deb
sudo apt install ./amdgpu-install_6.4.60400-1_all.deb
sudo apt update
```

`amdgpu-install --list-usecase`のコマンドでインストールする対象の一覧が表示される
dkms は全部のバージョンに含まれるらしい。

```
amd-ai-worker1:~$ amdgpu-install --list-usecase
If --usecase option is not present, the default selection is
"dkms,graphics,opencl,hip"
Available use cases:
dkms            (to only install the kernel mode driver)
  - Kernel mode driver (included in all usecases)
graphics        (for users of graphics applications)
  - Open source Mesa 3D graphics and multimedia libraries
multimedia      (for users of open source multimedia)
  - Open source Mesa 3D multimedia libraries
workstation     (for users of legacy WS applications)
  - Open source multimedia libraries
  - Closed source (legacy) OpenGL
rocm            (for users and developers requiring full ROCm stack)
  - OpenCL (ROCr/KFD based) runtime
  - HIP runtimes
  - Machine learning framework
  - All ROCm libraries and applications
wsl             (for using ROCm in a WSL context)
  - ROCr WSL runtime library (Ubuntu 22.04 only)
rocmdev         (for developers requiring ROCm runtime and
                profiling/debugging tools)
  - HIP runtimes
  - OpenCL runtime
  - Profiler, Tracer and Debugger tools
rocmdevtools    (for developers requiring ROCm profiling/debugging tools)
  - Profiler, Tracer and Debugger tools
amf             (for users of AMF based multimedia)
  - AMF closed source multimedia library
lrt             (for users of applications requiring ROCm runtime)
  - ROCm Compiler and device libraries
  - ROCr runtime and thunk
opencl          (for users of applications requiring OpenCL on Vega or later
                products)
  - ROCr based OpenCL
  - ROCm Language runtime
openclsdk       (for application developers requiring ROCr based OpenCL)
  - ROCr based OpenCL
  - ROCm Language runtime
  - development and SDK files for ROCr based OpenCL
hip             (for users of HIP runtime on AMD products)
  - HIP runtimes
hiplibsdk       (for application developers requiring HIP on AMD products)
  - HIP runtimes
  - ROCm math libraries
  - HIP development libraries
openmpsdk       (for users of openmp/flang on AMD products)
  - OpenMP runtime and devel packages
mllib           (for users executing machine learning workloads)
  - MIOpen hip/tensile libraries
  - Clang OpenCL
  - MIOpen kernels
mlsdk           (for developers executing machine learning workloads)
  - MIOpen development libraries
  - Clang OpenCL development libraries
  - MIOpen kernels
asan            (for users of ASAN enabled ROCm packages)
  - ASAN enabled OpenCL (ROCr/KFD based) runtime
  - ASAN enabled HIP runtimes
  - ASAN enabled Machine learning framework
  - ASAN enabled ROCm libraries
```

今回は LLM が目標のため rocm をインストールしてみる。
ついでに、rocm のユースケースには hip が含まれるが、llama.cpp のランタイムとして、hip を使うことができるのでそれを目指す。

```bash
amdgpu-install --usecase=rocm
...
amd-ai-worker1:~$ sudo dkms status
amdgpu/6.12.12-2147987.24.04, 6.11.0-25-generic, x86_64: installed
```

とりあえず GPU の情報を見たい.
nvidia-smi ならぬ amd-smi を使うことで、確認が可能

```
amd-ai-worker1:~$ amd-smi static
GPU: 0
    ASIC:
        MARKET_NAME: AMD Radeon Graphics
        VENDOR_ID: 0x1002
        VENDOR_NAME: Advanced Micro Devices Inc. [AMD/ATI]
        SUBVENDOR_ID: 0x2014
        DEVICE_ID: 0x1586
        SUBSYSTEM_ID: 0x801d
        REV_ID: 0xc1
        ASIC_SERIAL: N/A
        OAM_ID: N/A
        NUM_COMPUTE_UNITS: 40
        TARGET_GRAPHICS_VERSION: gfx1151
```

ここまで入れたら、nvtop を apt 経由でインストールすると普通に使える

厳密には fdinfo というインターフェース経由で GPU のリソースデータが公開されているらしく、
それを使っているとのこと

```
sudo apt install nvtop
```

![radeon](/assets/nvtop_igpu.png)

## NPU はどこいった？

NPU は別途ドライバをインストールする必要があり、amdgpu-installer では対応していない模様。

下記ページにてインストール可能だが、今後の宿題である

https://github.com/amd/xdna-driver?tab=readme-ov-file#introduction

## llama.cpp を動かす

こちらの hip インストールの項目より動かしてみる

https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md#hip

```
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
```

なお、HIP ランタイムで実行する場合、手動でのビルドが必要。
ビルド前に curl の dev パッケージがいる

```
sudo apt install curl libcurl4-openssl-dev
```

まず自分の iGPU の型番を調べる

```
amd-ai-worker1:~/work/llama.cpp$ rocminfo | grep gfx | head -1 | awk '{print $2}'
gfx1151
```

型番をターゲットにビルドする

ビルドは結構早い。

また、`-DGGML_HIP_ROCWMMA_FATTN=ON`をビルド引数で渡すと、ROCWMMA と FlashAttentionk 機能を有効化してくれる

ROCWMMA はいい感じに演算を加速してくれるやつ

16 コア 32 スレッドは伊達じゃない。

```
HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" \
    cmake -S . -B build -DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151 -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -- -j 16

...

#ログ
amd-ai-worker1:~/work/llama.cpp$ HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" \
>     cmake -S . -B build -DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151 -DCMAKE_BUILD_TYPE=Release \
>     && cmake --build build --config Release -- -j 16
-- The C compiler identification is GNU 13.3.0
-- The CXX compiler identification is GNU 13.3.0
-- Detecting C compiler ABI info
-- Detecting C compiler ABI info - done
-- Check for working C compiler: /usr/bin/cc - skipped
-- Detecting C compile features
-- Detecting C compile features - done
-- Detecting CXX compiler ABI info
-- Detecting CXX compiler ABI info - done
-- Check for working CXX compiler: /usr/bin/c++ - skipped
-- Detecting CXX compile features
-- Detecting CXX compile features - done
-- Found Git: /usr/bin/git (found version "2.43.0")
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD - Success
-- Found Threads: TRUE
-- Warning: ccache not found - consider installing it for faster compilation or disable this warning with GGML_CCACHE=OFF
-- CMAKE_SYSTEM_PROCESSOR: x86_64
-- Including CPU backend
-- Found OpenMP_C: -fopenmp (found version "4.5")
-- Found OpenMP_CXX: -fopenmp (found version "4.5")
-- Found OpenMP: TRUE (found version "4.5")
-- x86 detected
-- Adding CPU backend variant ggml-cpu: -march=native
-- The HIP compiler identification is Clang 19.0.0
-- Detecting HIP compiler ABI info
-- Detecting HIP compiler ABI info - done
-- Check for working HIP compiler: /opt/rocm-6.4.0/lib/llvm/bin/clang - skipped
-- Detecting HIP compile features
-- Detecting HIP compile features - done
CMake Warning (dev) at /opt/rocm/lib/cmake/hip/hip-config-amd.cmake:70 (message):
  AMDGPU_TARGETS is deprecated.  Please use GPU_TARGETS instead.
Call Stack (most recent call first):
  /opt/rocm/lib/cmake/hip/hip-config.cmake:149 (include)
  ggml/src/ggml-hip/CMakeLists.txt:39 (find_package)
This warning is for project developers.  Use -Wno-dev to suppress it.

-- HIP and hipBLAS found
-- Including HIP backend
-- Found CURL: /usr/lib/x86_64-linux-gnu/libcurl.so (found version "8.5.0")
-- Configuring done (1.7s)
-- Generating done (0.1s)
-- Build files have been written to: /home/amemiya/work/llama.cpp/build

...

[ 97%] Linking CXX executable ../../bin/llama-quantize
[ 97%] Built target llama-quantize
[ 97%] Linking CXX executable ../../bin/llama-cli
[ 97%] Building CXX object tools/server/CMakeFiles/llama-server.dir/server.cpp.o
[ 97%] Built target llama-cli
[ 97%] Linking CXX executable ../../bin/llama-mtmd-cli
[ 97%] Built target llama-mtmd-cli
[ 97%] Linking CXX executable ../../bin/llama-imatrix
[ 97%] Linking CXX executable ../../bin/llama-export-lora
[ 97%] Linking CXX executable ../../bin/llama-cvector-generator
[ 97%] Built target llama-imatrix
[ 97%] Built target llama-export-lora
[ 97%] Built target llama-cvector-generator
[ 97%] Linking CXX executable ../../bin/llama-perplexity
[ 97%] Built target llama-perplexity
[ 97%] Linking CXX executable ../bin/test-json-schema-to-grammar
[ 97%] Built target test-json-schema-to-grammar
[ 98%] Linking CXX executable ../../bin/llama-run
[ 98%] Built target llama-run
[ 99%] Linking CXX executable ../bin/test-chat
[ 99%] Built target test-chat
[ 99%] Linking CXX executable ../bin/test-backend-ops
[ 99%] Built target test-backend-ops
[ 99%] Linking CXX executable ../../bin/llama-bench
[ 99%] Built target llama-bench
[ 99%] Linking CXX executable ../../bin/llama-tts
[ 99%] Built target llama-tts
[100%] Linking CXX executable ../../bin/llama-server
[100%] Built target llama-server
```

llama-cli を動かして、動くか確かめる。

なお、`GGML_CUDA_ENABLE_UNIFIED_MEMORY=1`を環境変数で渡すと、unified memory を有効化してくれるらしい（ほんとか？）

```
GGML_CUDA_ENABLE_UNIFIED_MEMORY=1  build/bin/llama-cli -ngl 29  -hf unsloth/Qwen3-0.6B-GGUF:Q8_0

-> gfx1151がtensileで対応していないと言われ、動かない状態に


```

linux のカーネルが 6.11 だが、これだとダメなのかもしれない。要調査

# (vulkan に)切り替えていく

hip を使った実行がうまくいかないので、vulkan を使う方向に舵を切る

vulkan のインストール

```
wget -qO- https://packages.lunarg.com/lunarg-signing-key-pub.asc | sudo tee /etc/apt/trusted.gpg.d/lunarg.asc
sudo wget -qO /etc/apt/sources.list.d/lunarg-vulkan-noble.list http://packages.lunarg.com/vulkan/lunarg-vulkan-noble.list
sudo apt update
sudo apt install vulkan-sdk
```

インストール確認

```
@amd-ai-worker1:~/work/llama.cpp$ vulkaninfo
WARNING: [Loader Message] Code 0 : Layer VK_LAYER_MESA_device_select uses API version 1.3 which is older than the applica
tion specified API version of 1.4. May cause issues.
'DISPLAY' environment variable not set... skipping surface info
==========
VULKANINFO
==========

Vulkan Instance Version: 1.4.313


Instance Extensions: count = 24
===============================
        VK_EXT_acquire_drm_display             : extension revision 1
        VK_EXT_acquire_xlib_display            : extension revision 1
        VK_EXT_debug_report                    : extension revision 10
        VK_EXT_debug_utils                     : extension revision 2
        VK_EXT_direct_mode_display             : extension revision 1
        VK_EXT_display_surface_counter         : extension revision 1
        VK_EXT_headless_surface                : extension revision 1
        VK_EXT_surface_maintenance1            : extension revision 1
        VK_EXT_swapchain_colorspace            : extension revision 4
        VK_KHR_device_group_creation           : extension revision 1
        VK_KHR_display                         : extension revision 23
        VK_KHR_external_fence_capabilities     : extension revision 1
        VK_KHR_external_memory_capabilities    : extension revision 1
        VK_KHR_external_semaphore_capabilities : extension revision 1
        VK_KHR_get_display_properties2         : extension revision 1
        VK_KHR_get_physical_device_properties2 : extension revision 2
        VK_KHR_get_surface_capabilities2       : extension revision 1
        VK_KHR_portability_enumeration         : extension revision 1
        VK_KHR_surface                         : extension revision 25
        VK_KHR_surface_protected_capabilities  : extension revision 1
        VK_KHR_wayland_surface                 : extension revision 6
        VK_KHR_xcb_surface                     : extension revision 6
        VK_KHR_xlib_surface                    : extension revision 6
        VK_LUNARG_direct_driver_loading        : extension revision 1

Layers: count = 12
==================
VK_LAYER_INTEL_nullhw (INTEL NULL HW) Vulkan version 1.1.73, layer version 1:
        Layer Extensions: count = 0
        Devices: count = 2
                GPU id = 0 (AMD Radeon Graphics (RADV GFX1151))
                Layer-Device Extensions: count = 0

                GPU id = 1 (llvmpipe (LLVM 19.1.1, 256 bits))
                Layer-Device Extensions: count = 0
```

認識しているので問題なく入っていると仮定

llama.cpp のビルド
hip のビルドと比較して時間がかかる

```bash
amd-ai-worker1:~/work/llama.cpp-vulkan$ cmake -B build -DGGML_VULKAN=1 \
&& cmake --build build --config Release

...

[ 94%] Built target llama-llava-cli
[ 95%] Built target llama-gemma3-cli
[ 96%] Built target llama-minicpmv-cli
[ 97%] Built target llama-qwen2vl-cli
[ 98%] Built target llama-mtmd-cli
[ 99%] Built target llama-cvector-generator
[100%] Built target llama-export-lora
```

無事 GPU メモリに乗った

unified memory はちゃんと使えるのかが不明

```
amd-ai-worker1:~/work/llama.cpp-vulkan$ build/bin/llama-cli -ngl 29  -hf unsloth/Qwen3-0.6B-GGUF:Q8_0
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat
curl_perform_with_retry: HEAD https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf (attempt 1 of 1)...
common_download_file_single: using cached file: /home/amemiya/.cache/llama.cpp/unsloth_Qwen3-0.6B-GGUF_Qwen3-0.6B-Q8_0.gguf
build: 5398 (c531edfa) with cc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0 for x86_64-linux-gnu
main: llama backend init
main: load the model and apply lora adapter, if any
llama_model_load_from_file_impl: using device Vulkan0 (AMD Radeon Graphics (RADV GFX1151)) - 65002 MiB free
llama_model_loader: loaded meta data with 32 key-value pairs and 310 tensors from /home/amemiya/.cache/llama.cpp/unsloth_Qwen3-0.6B-GGUF_Qwen3-0.6B-Q8_0.gguf (version GGUF V3 (latest))
llama_model_loader: Dumping metadata keys/values. Note: KV overrides do not apply in this output.
llama_model_loader: - kv   0:                       general.architecture str              = qwen3
llama_model_loader: - kv   1:                               general.type str              = model
llama_model_loader: - kv   2:                               general.name str              = Qwen3-0.6B
llama_model_loader: - kv   3:                           general.basename str              = Qwen3-0.6B
llama_model_loader: - kv   4:                       general.quantized_by str              = Unsloth
llama_model_loader: - kv   5:                         general.size_label str              = 0.6B
llama_model_loader: - kv   6:                           general.repo_url str              = https://huggingface.co/unsloth
llama_model_loader: - kv   7:                          qwen3.block_count u32              = 28
llama_model_loader: - kv   8:                       qwen3.context_length u32              = 40960
llama_model_loader: - kv   9:                     qwen3.embedding_length u32              = 1024
llama_model_loader: - kv  10:                  qwen3.feed_forward_length u32              = 3072
llama_model_loader: - kv  11:                 qwen3.attention.head_count u32              = 16
llama_model_loader: - kv  12:              qwen3.attention.head_count_kv u32              = 8
llama_model_loader: - kv  13:                       qwen3.rope.freq_base f32              = 1000000.000000
llama_model_loader: - kv  14:     qwen3.attention.layer_norm_rms_epsilon f32              = 0.000001
llama_model_loader: - kv  15:                 qwen3.attention.key_length u32              = 128
llama_model_loader: - kv  16:               qwen3.attention.value_length u32              = 128
llama_model_loader: - kv  17:                       tokenizer.ggml.model str              = gpt2
llama_model_loader: - kv  18:                         tokenizer.ggml.pre str              = qwen2
llama_model_loader: - kv  19:                      tokenizer.ggml.tokens arr[str,151936]  = ["!", "\"", "#", "$", "%", "&", "'", ...
llama_model_loader: - kv  20:                  tokenizer.ggml.token_type arr[i32,151936]  = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...
llama_model_loader: - kv  21:                      tokenizer.ggml.merges arr[str,151387]  = ["Ġ Ġ", "ĠĠ ĠĠ", "i n", "Ġ t",...
llama_model_loader: - kv  22:                tokenizer.ggml.eos_token_id u32              = 151645
llama_model_loader: - kv  23:            tokenizer.ggml.padding_token_id u32              = 151654
llama_model_loader: - kv  24:               tokenizer.ggml.add_bos_token bool             = false
llama_model_loader: - kv  25:                    tokenizer.chat_template str              = {%- if tools %}\n    {{- '<|im_start|>...
llama_model_loader: - kv  26:               general.quantization_version u32              = 2
llama_model_loader: - kv  27:                          general.file_type u32              = 7
llama_model_loader: - kv  28:                      quantize.imatrix.file str              = Qwen3-0.6B-GGUF/imatrix_unsloth.dat
llama_model_loader: - kv  29:                   quantize.imatrix.dataset str              = unsloth_calibration_Qwen3-0.6B.txt
llama_model_loader: - kv  30:             quantize.imatrix.entries_count i32              = 196
llama_model_loader: - kv  31:              quantize.imatrix.chunks_count i32              = 685
llama_model_loader: - type  f32:  113 tensors
llama_model_loader: - type q8_0:  197 tensors
print_info: file format = GGUF V3 (latest)
print_info: file type   = Q8_0
print_info: file size   = 604.15 MiB (8.50 BPW)
load: special tokens cache size = 26
load: token to piece cache size = 0.9311 MB
print_info: arch             = qwen3
print_info: vocab_only       = 0
print_info: n_ctx_train      = 40960
print_info: n_embd           = 1024
print_info: n_layer          = 28
print_info: n_head           = 16
print_info: n_head_kv        = 8
print_info: n_rot            = 128
print_info: n_swa            = 0
print_info: n_swa_pattern    = 1
print_info: n_embd_head_k    = 128
print_info: n_embd_head_v    = 128
print_info: n_gqa            = 2
print_info: n_embd_k_gqa     = 1024
print_info: n_embd_v_gqa     = 1024
print_info: f_norm_eps       = 0.0e+00
print_info: f_norm_rms_eps   = 1.0e-06
print_info: f_clamp_kqv      = 0.0e+00
print_info: f_max_alibi_bias = 0.0e+00
print_info: f_logit_scale    = 0.0e+00
print_info: f_attn_scale     = 0.0e+00
print_info: n_ff             = 3072
print_info: n_expert         = 0
print_info: n_expert_used    = 0
print_info: causal attn      = 1
print_info: pooling type     = 0
print_info: rope type        = 2
print_info: rope scaling     = linear
print_info: freq_base_train  = 1000000.0
print_info: freq_scale_train = 1
print_info: n_ctx_orig_yarn  = 40960
print_info: rope_finetuned   = unknown
print_info: ssm_d_conv       = 0
print_info: ssm_d_inner      = 0
print_info: ssm_d_state      = 0
print_info: ssm_dt_rank      = 0
print_info: ssm_dt_b_c_rms   = 0
print_info: model type       = 0.6B
print_info: model params     = 596.05 M
print_info: general.name     = Qwen3-0.6B
print_info: vocab type       = BPE
print_info: n_vocab          = 151936
print_info: n_merges         = 151387
print_info: BOS token        = 11 ','
print_info: EOS token        = 151645 '<|im_end|>'
print_info: EOT token        = 151645 '<|im_end|>'
print_info: PAD token        = 151654 '<|vision_pad|>'
print_info: LF token         = 198 'Ċ'
print_info: FIM PRE token    = 151659 '<|fim_prefix|>'
print_info: FIM SUF token    = 151661 '<|fim_suffix|>'
print_info: FIM MID token    = 151660 '<|fim_middle|>'
print_info: FIM PAD token    = 151662 '<|fim_pad|>'
print_info: FIM REP token    = 151663 '<|repo_name|>'
print_info: FIM SEP token    = 151664 '<|file_sep|>'
print_info: EOG token        = 151643 '<|endoftext|>'
print_info: EOG token        = 151645 '<|im_end|>'
print_info: EOG token        = 151662 '<|fim_pad|>'
print_info: EOG token        = 151663 '<|repo_name|>'
print_info: EOG token        = 151664 '<|file_sep|>'
print_info: max token length = 256
load_tensors: loading model tensors, this can take a while... (mmap = true)
load_tensors: offloading 28 repeating layers to GPU
load_tensors: offloading output layer to GPU
load_tensors: offloaded 29/29 layers to GPU
load_tensors:      Vulkan0 model buffer size =   604.15 MiB
load_tensors:   CPU_Mapped model buffer size =   157.65 MiB
.............................................................
llama_context: constructing llama_context
llama_context: n_seq_max     = 1
llama_context: n_ctx         = 4096
llama_context: n_ctx_per_seq = 4096
llama_context: n_batch       = 2048
llama_context: n_ubatch      = 512
llama_context: causal_attn   = 1
llama_context: flash_attn    = 0
llama_context: freq_base     = 1000000.0
llama_context: freq_scale    = 1
llama_context: n_ctx_per_seq (4096) < n_ctx_train (40960) -- the full capacity of the model will not be utilized
llama_context: Vulkan_Host  output buffer size =     0.58 MiB
llama_kv_cache_unified: kv_size = 4096, type_k = 'f16', type_v = 'f16', n_layer = 28, can_shift = 1, padding = 32
llama_kv_cache_unified:    Vulkan0 KV buffer size =   448.00 MiB
llama_kv_cache_unified: KV self size  =  448.00 MiB, K (f16):  224.00 MiB, V (f16):  224.00 MiB
llama_context:    Vulkan0 compute buffer size =   298.75 MiB
llama_context: Vulkan_Host compute buffer size =    10.01 MiB
llama_context: graph nodes  = 1070
llama_context: graph splits = 2
common_init_from_params: setting dry_penalty_last_n to ctx_size = 4096
common_init_from_params: warming up the model with an empty run - please wait ... (--no-warmup to disable)
main: llama threadpool init, n_threads = 16
main: chat template is available, enabling conversation mode (disable it with -no-cnv)
main: chat template example:
<|im_start|>system
You are a helpful assistant<|im_end|>
<|im_start|>user
Hello<|im_end|>
<|im_start|>assistant
Hi there<|im_end|>
<|im_start|>user
How are you?<|im_end|>
<|im_start|>assistant


system_info: n_threads = 16 (n_threads_batch = 16) / 32 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX_VNNI = 1 | AVX2 = 1 | F16C = 1 | FMA = 1 | BMI2 = 1 | AVX512 = 1 | AVX512_VBMI = 1 | AVX512_VNNI = 1 | AVX512_BF16 = 1 | LLAMAFILE = 1 | OPENMP = 1 | AARCH64_REPACK = 1 |

main: interactive mode on.
sampler seed: 2439338068
sampler params:
        repeat_last_n = 64, repeat_penalty = 1.000, frequency_penalty = 0.000, presence_penalty = 0.000
        dry_multiplier = 0.000, dry_base = 1.750, dry_allowed_length = 2, dry_penalty_last_n = 4096
        top_k = 40, top_p = 0.950, min_p = 0.050, xtc_probability = 0.000, xtc_threshold = 0.100, typical_p = 1.000, top_n_sigma = -1.000, temp = 0.800
        mirostat = 0, mirostat_lr = 0.100, mirostat_ent = 5.000
sampler chain: logits -> logit-bias -> penalties -> dry -> top-n-sigma -> top-k -> typical -> top-p -> min-p -> xtc -> temp-ext -> dist
generate: n_ctx = 4096, n_batch = 2048, n_predict = -1, n_keep = 0

== Running in interactive mode. ==
 - Press Ctrl+C to interject at any time.
 - Press Return to return control to the AI.
 - To return control without starting a new line, end your input with '/'.
 - If you want to submit another line, end your input with '\'.
 - Not using system message. To change it, set a different value via -sys PROMPT


> こんにちは
<think>
Okay, the user said "こんにちは" which is Japanese. I need to respond appropriately. Since I'm a language model, I should acknowledge their greeting. Maybe say "こんにちは" and offer help. Keep it friendly and open-ended so they feel comfortable. Let me check if there's any cultural nuances I should consider, but I think a simple response should suffice.
</think>

こんにちは！何かご質問やご案内できますか？😊

>
```

0.6B なのでかなり速いスピードで動いたが、これは当然である。

Qwen3-30-a3b を走らせてみる
https://huggingface.co/unsloth/Qwen3-30B-A3B-128K-GGUF

Unsloth の量子化モデルの、Q8_K_XL を動かしてみる。RTX4090 ではできない領域なので動かしてみたかったというのが大きい。

モデルのダウンロード

```bash
amd-ai-worker1:/mnt/data/models/llama.cpp/common$ wget https://huggingface.co/unsloth/Qwen3-30B-A3B-128K-GGUF/resolve/main/Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf

--2025-05-17 00:54:35--  https://huggingface.co/unsloth/Qwen3-30B-A3B-128K-GGUF/resolve/main/Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf
Resolving huggingface.co (huggingface.co)... 3.164.110.77, 3.164.110.128, 3.164.110.3, ...
Connecting to huggingface.co (huggingface.co)|3.164.110.77|:443... connected.
HTTP request sent, awaiting response... 302 Found
Location: https://cas-bridge.xethub.hf.co/xet-bridge-us/68108d52210d0fd5a1b04b87/39a336c9bbdac821d82a5b38c14347cd7a79d010d54a923f24293f75e2771c1c?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=cas%2F20250516%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20250516T155435Z&X-Amz-Expires=3600&X-Amz-Signature=ed690ca6f01299f2c675abb7b3dc94230be397112b972fff48adaf4ef3891e9b&X-Amz-SignedHeaders=host&X-Xet-Cas-Uid=public&response-content-disposition=inline%3B+filename*%3DUTF-8%27%27Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf%3B+filename%3D%22Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf%22%3B&x-id=GetObject&Expires=1747414475&Policy=eyJTdGF0ZW1lbnQiOlt7IkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc0NzQxNDQ3NX19LCJSZXNvdXJjZSI6Imh0dHBzOi8vY2FzLWJyaWRnZS54ZXRodWIuaGYuY28veGV0LWJyaWRnZS11cy82ODEwOGQ1MjIxMGQwZmQ1YTFiMDRiODcvMzlhMzM2YzliYmRhYzgyMWQ4MmE1YjM4YzE0MzQ3Y2Q3YTc5ZDAxMGQ1NGE5MjNmMjQyOTNmNzVlMjc3MWMxYyoifV19&Signature=EnlyjV9Q7Cj4sEWvfBM%7ETJ0rmKU3xwBJPY7ZhoaIhTNLND17x%7EEr16iOCpbOs6kl5j6HjOguT%7EeQMN-KOPyYFktONDhd4nijKujF-PyJ2EheHB85ctTSVXTlo3E9Xg9oGTXnLLVsuRoAEVO0kRCGhjlUzJQji%7El33ey%7Eu8-gTlq14awGL4XTPRQq40xS80NzFzKmWcKP5N85Mk2upp07MEWoEs56j4IEuoomiqOqtDmt-%7EUjD4ODF8RbrzV0O-KEEggMMPnqobXlrZ6Dg%7ELvPQ7pcpZjgaPM%7EuIykHIOkw0yhj-y5x%7EHW8dag6xXdiQWMSOAhUb-JmOrfD-1Ul8f5A__&Key-Pair-Id=K2L8F4GPSG1IFC [following]
--2025-05-17 00:54:35--  https://cas-bridge.xethub.hf.co/xet-bridge-us/68108d52210d0fd5a1b04b87/39a336c9bbdac821d82a5b38c14347cd7a79d010d54a923f24293f75e2771c1c?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=cas%2F20250516%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20250516T155435Z&X-Amz-Expires=3600&X-Amz-Signature=ed690ca6f01299f2c675abb7b3dc94230be397112b972fff48adaf4ef3891e9b&X-Amz-SignedHeaders=host&X-Xet-Cas-Uid=public&response-content-disposition=inline%3B+filename*%3DUTF-8%27%27Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf%3B+filename%3D%22Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf%22%3B&x-id=GetObject&Expires=1747414475&Policy=eyJTdGF0ZW1lbnQiOlt7IkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc0NzQxNDQ3NX19LCJSZXNvdXJjZSI6Imh0dHBzOi8vY2FzLWJyaWRnZS54ZXRodWIuaGYuY28veGV0LWJyaWRnZS11cy82ODEwOGQ1MjIxMGQwZmQ1YTFiMDRiODcvMzlhMzM2YzliYmRhYzgyMWQ4MmE1YjM4YzE0MzQ3Y2Q3YTc5ZDAxMGQ1NGE5MjNmMjQyOTNmNzVlMjc3MWMxYyoifV19&Signature=EnlyjV9Q7Cj4sEWvfBM%7ETJ0rmKU3xwBJPY7ZhoaIhTNLND17x%7EEr16iOCpbOs6kl5j6HjOguT%7EeQMN-KOPyYFktONDhd4nijKujF-PyJ2EheHB85ctTSVXTlo3E9Xg9oGTXnLLVsuRoAEVO0kRCGhjlUzJQji%7El33ey%7Eu8-gTlq14awGL4XTPRQq40xS80NzFzKmWcKP5N85Mk2upp07MEWoEs56j4IEuoomiqOqtDmt-%7EUjD4ODF8RbrzV0O-KEEggMMPnqobXlrZ6Dg%7ELvPQ7pcpZjgaPM%7EuIykHIOkw0yhj-y5x%7EHW8dag6xXdiQWMSOAhUb-JmOrfD-1Ul8f5A__&Key-Pair-Id=K2L8F4GPSG1IFC
Resolving cas-bridge.xethub.hf.co (cas-bridge.xethub.hf.co)... 3.164.110.47, 3.164.110.49, 3.164.110.22, ...
Connecting to cas-bridge.xethub.hf.co (cas-bridge.xethub.hf.co)|3.164.110.47|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 35989945120 (34G)
Saving to: ‘Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf’

Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf        100%[==================================================================================================================================================================================>]  33.52G  32.5MB/s    in 20m 2s

2025-05-17 01:14:38 (28.6 MB/s) - ‘Qwen3-30B-A3B-128K-UD-Q8_K_XL.gguf’ saved [35989945120/35989945120]

```

また、Qwen235B a22b の q3_k_s も乗った

93/95 レイヤーが GPU offload できる限界

```
amd-ai-worker1:~/work/llama.cpp-vulkan$ build/bin/llama-cli -ngl 93 --model /mnt/data/models/llama.cpp/common/Qwen3-235B-A22B-Q3_K_S-00001-of-00003.gguf
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat
build: 5398 (c531edfa) with cc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0 for x86_64-linux-gnu
main: llama backend init
main: load the model and apply lora adapter, if any
llama_model_load_from_file_impl: using device Vulkan0 (AMD Radeon Graphics (RADV GFX1151)) - 65002 MiB free
llama_model_loader: additional 2 GGUFs metadata loaded.
llama_model_loader: loaded meta data with 46 key-value pairs and 1131 tensors from /mnt/data/models/llama.cpp/common/Qwen3-235B-A22B-Q3_K_S-00001-of-00003.gguf (version GGUF V3 (latest))
llama_model_loader: Dumping metadata keys/values. Note: KV overrides do not apply in this output.
llama_model_loader: - kv   0:                       general.architecture str              = qwen3moe
llama_model_loader: - kv   1:                               general.type str              = model
llama_model_loader: - kv   2:                               general.name str              = Qwen3-235B-A22B
llama_model_loader: - kv   3:                           general.basename str              = Qwen3-235B-A22B
llama_model_loader: - kv   4:                       general.quantized_by str              = Unsloth
llama_model_loader: - kv   5:                         general.size_label str              = 235B-A22B
llama_model_loader: - kv   6:                            general.license str              = apache-2.0
llama_model_loader: - kv   7:                       general.license.link str              = https://huggingface.co/Qwen/Qwen3-235...
llama_model_loader: - kv   8:                           general.repo_url str              = https://huggingface.co/unsloth
llama_model_loader: - kv   9:                   general.base_model.count u32              = 1
llama_model_loader: - kv  10:                  general.base_model.0.name str              = Qwen3 235B A22B
llama_model_loader: - kv  11:          general.base_model.0.organization str              = Qwen
llama_model_loader: - kv  12:              general.base_model.0.repo_url str              = https://huggingface.co/Qwen/Qwen3-235...
llama_model_loader: - kv  13:                               general.tags arr[str,2]       = ["unsloth", "text-generation"]
llama_model_loader: - kv  14:                       qwen3moe.block_count u32              = 94
llama_model_loader: - kv  15:                    qwen3moe.context_length u32              = 40960
llama_model_loader: - kv  16:                  qwen3moe.embedding_length u32              = 4096
llama_model_loader: - kv  17:               qwen3moe.feed_forward_length u32              = 12288
llama_model_loader: - kv  18:              qwen3moe.attention.head_count u32              = 64
llama_model_loader: - kv  19:           qwen3moe.attention.head_count_kv u32              = 4
llama_model_loader: - kv  20:                    qwen3moe.rope.freq_base f32              = 1000000.000000
llama_model_loader: - kv  21:  qwen3moe.attention.layer_norm_rms_epsilon f32              = 0.000001
llama_model_loader: - kv  22:                 qwen3moe.expert_used_count u32              = 8
llama_model_loader: - kv  23:              qwen3moe.attention.key_length u32              = 128
llama_model_loader: - kv  24:            qwen3moe.attention.value_length u32              = 128
llama_model_loader: - kv  25:                      qwen3moe.expert_count u32              = 128
llama_model_loader: - kv  26:        qwen3moe.expert_feed_forward_length u32              = 1536
llama_model_loader: - kv  27:                       tokenizer.ggml.model str              = gpt2
llama_model_loader: - kv  28:                         tokenizer.ggml.pre str              = qwen2
llama_model_loader: - kv  29:                      tokenizer.ggml.tokens arr[str,151936]  = ["!", "\"", "#", "$", "%", "&", "'", ...
llama_model_loader: - kv  30:                  tokenizer.ggml.token_type arr[i32,151936]  = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...
llama_model_loader: - kv  31:                      tokenizer.ggml.merges arr[str,151387]  = ["Ġ Ġ", "ĠĠ ĠĠ", "i n", "Ġ t",...
llama_model_loader: - kv  32:                tokenizer.ggml.eos_token_id u32              = 151645
llama_model_loader: - kv  33:            tokenizer.ggml.padding_token_id u32              = 151654
llama_model_loader: - kv  34:                tokenizer.ggml.bos_token_id u32              = 151643
llama_model_loader: - kv  35:               tokenizer.ggml.add_bos_token bool             = false
llama_model_loader: - kv  36:                    tokenizer.chat_template str              = {%- if tools %}\n    {{- '<|im_start|>...
llama_model_loader: - kv  37:               general.quantization_version u32              = 2
llama_model_loader: - kv  38:                          general.file_type u32              = 11
llama_model_loader: - kv  39:                      quantize.imatrix.file str              = Qwen3-235B-A22B-GGUF/imatrix_unsloth.dat
llama_model_loader: - kv  40:                   quantize.imatrix.dataset str              = unsloth_calibration_Qwen3-235B-A22B.txt
llama_model_loader: - kv  41:             quantize.imatrix.entries_count i32              = 744
llama_model_loader: - kv  42:              quantize.imatrix.chunks_count i32              = 685
llama_model_loader: - kv  43:                                   split.no u16              = 0
llama_model_loader: - kv  44:                        split.tensors.count i32              = 1131
llama_model_loader: - kv  45:                                split.count u16              = 3
llama_model_loader: - type  f32:  471 tensors
llama_model_loader: - type q3_K:  659 tensors
llama_model_loader: - type q6_K:    1 tensors
print_info: file format = GGUF V3 (latest)
print_info: file type   = Q3_K - Small
print_info: file size   = 94.47 GiB (3.45 BPW)
load: special tokens cache size = 26
load: token to piece cache size = 0.9311 MB
print_info: arch             = qwen3moe
print_info: vocab_only       = 0
print_info: n_ctx_train      = 40960
print_info: n_embd           = 4096
print_info: n_layer          = 94
print_info: n_head           = 64
print_info: n_head_kv        = 4
print_info: n_rot            = 128
print_info: n_swa            = 0
print_info: n_swa_pattern    = 1
print_info: n_embd_head_k    = 128
print_info: n_embd_head_v    = 128
print_info: n_gqa            = 16
print_info: n_embd_k_gqa     = 512
print_info: n_embd_v_gqa     = 512
print_info: f_norm_eps       = 0.0e+00
print_info: f_norm_rms_eps   = 1.0e-06
print_info: f_clamp_kqv      = 0.0e+00
print_info: f_max_alibi_bias = 0.0e+00
print_info: f_logit_scale    = 0.0e+00
print_info: f_attn_scale     = 0.0e+00
print_info: n_ff             = 12288
print_info: n_expert         = 128
print_info: n_expert_used    = 8
print_info: causal attn      = 1
print_info: pooling type     = 0
print_info: rope type        = 2
print_info: rope scaling     = linear
print_info: freq_base_train  = 1000000.0
print_info: freq_scale_train = 1
print_info: n_ctx_orig_yarn  = 40960
print_info: rope_finetuned   = unknown
print_info: ssm_d_conv       = 0
print_info: ssm_d_inner      = 0
print_info: ssm_d_state      = 0
print_info: ssm_dt_rank      = 0
print_info: ssm_dt_b_c_rms   = 0
print_info: model type       = 235B.A22B
print_info: model params     = 235.09 B
print_info: general.name     = Qwen3-235B-A22B
print_info: n_ff_exp         = 1536
print_info: vocab type       = BPE
print_info: n_vocab          = 151936
print_info: n_merges         = 151387
print_info: BOS token        = 151643 '<|endoftext|>'
print_info: EOS token        = 151645 '<|im_end|>'
print_info: EOT token        = 151645 '<|im_end|>'
print_info: PAD token        = 151654 '<|vision_pad|>'
print_info: LF token         = 198 'Ċ'
print_info: FIM PRE token    = 151659 '<|fim_prefix|>'
print_info: FIM SUF token    = 151661 '<|fim_suffix|>'
print_info: FIM MID token    = 151660 '<|fim_middle|>'
print_info: FIM PAD token    = 151662 '<|fim_pad|>'
print_info: FIM REP token    = 151663 '<|repo_name|>'
print_info: FIM SEP token    = 151664 '<|file_sep|>'
print_info: EOG token        = 151643 '<|endoftext|>'
print_info: EOG token        = 151645 '<|im_end|>'
print_info: EOG token        = 151662 '<|fim_pad|>'
print_info: EOG token        = 151663 '<|repo_name|>'
print_info: EOG token        = 151664 '<|file_sep|>'
print_info: max token length = 256
load_tensors: loading model tensors, this can take a while... (mmap = true)
load_tensors: offloading 93 repeating layers to GPU
load_tensors: offloaded 93/95 layers to GPU
load_tensors:      Vulkan0 model buffer size = 94976.34 MiB
load_tensors:   CPU_Mapped model buffer size =  1763.14 MiB
....................................................................................................
llama_context: constructing llama_context
llama_context: n_seq_max     = 1
llama_context: n_ctx         = 4096
llama_context: n_ctx_per_seq = 4096
llama_context: n_batch       = 2048
llama_context: n_ubatch      = 512
llama_context: causal_attn   = 1
llama_context: flash_attn    = 0
llama_context: freq_base     = 1000000.0
llama_context: freq_scale    = 1
llama_context: n_ctx_per_seq (4096) < n_ctx_train (40960) -- the full capacity of the model will not be utilized
llama_context:        CPU  output buffer size =     0.58 MiB
llama_kv_cache_unified: kv_size = 4096, type_k = 'f16', type_v = 'f16', n_layer = 94, can_shift = 1, padding = 32
llama_kv_cache_unified:    Vulkan0 KV buffer size =   744.00 MiB
llama_kv_cache_unified:        CPU KV buffer size =     8.00 MiB
llama_kv_cache_unified: KV self size  =  752.00 MiB, K (f16):  376.00 MiB, V (f16):  376.00 MiB
llama_context:    Vulkan0 compute buffer size =   791.61 MiB
llama_context: Vulkan_Host compute buffer size =    16.01 MiB
llama_context: graph nodes  = 6116
llama_context: graph splits = 19 (with bs=512), 5 (with bs=1)
common_init_from_params: setting dry_penalty_last_n to ctx_size = 4096
common_init_from_params: warming up the model with an empty run - please wait ... (--no-warmup to disable)
main: llama threadpool init, n_threads = 16
main: chat template is available, enabling conversation mode (disable it with -no-cnv)
main: chat template example:
<|im_start|>system
You are a helpful assistant<|im_end|>
<|im_start|>user
Hello<|im_end|>
<|im_start|>assistant
Hi there<|im_end|>
<|im_start|>user
How are you?<|im_end|>
<|im_start|>assistant


system_info: n_threads = 16 (n_threads_batch = 16) / 32 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX_VNNI = 1 | AVX2 = 1 | F16C = 1 | FMA = 1 | BMI2 = 1 | AVX512 = 1 | AVX512_VBMI = 1 | AVX512_VNNI = 1 | AVX512_BF16 = 1 | LLAMAFILE = 1 | OPENMP = 1 | AARCH64_REPACK = 1 |

main: interactive mode on.
sampler seed: 2837705288
sampler params:
        repeat_last_n = 64, repeat_penalty = 1.000, frequency_penalty = 0.000, presence_penalty = 0.000
        dry_multiplier = 0.000, dry_base = 1.750, dry_allowed_length = 2, dry_penalty_last_n = 4096
        top_k = 40, top_p = 0.950, min_p = 0.050, xtc_probability = 0.000, xtc_threshold = 0.100, typical_p = 1.000, top_n_sigma = -1.000, temp = 0.800
        mirostat = 0, mirostat_lr = 0.100, mirostat_ent = 5.000
sampler chain: logits -> logit-bias -> penalties -> dry -> top-n-sigma -> top-k -> typical -> top-p -> min-p -> xtc -> temp-ext -> dist
generate: n_ctx = 4096, n_batch = 2048, n_predict = -1, n_keep = 0

== Running in interactive mode. ==
 - Press Ctrl+C to interject at any time.
 - Press Return to return control to the AI.
 - To return control without starting a new line, end your input with '/'.
 - If you want to submit another line, end your input with '\'.
 - Not using system message. To change it, set a different value via -sys PROMPT


> こんにちは
<think>
Alright, the user greeted me with "こんにちは", which is Japanese for "Hello". I should respond in kind, using Japanese to keep the conversation natural. I'll make sure to greet them back and offer assistance in a friendly manner.

Let me check if there's any specific cultural nuance I should be aware of. Since it's a simple greeting, a straightforward response should suffice. I'll keep it polite and open-ended to encourage them to ask any questions they might have.

Okay, the response should be something like: "こんにちは！何かお手伝いできることがありますか？" which translates to "Hello! Is there anything I can help you with?" That sounds good. It's polite, welcoming, and offers assistance.
</think>

こんにちは！何かお手伝いできることがありますか？


```

# vulkan 環境の各 LLM モデルのベンチマーク結果

### Qwen3-235B-A22B_Q3_K_S(95GB)

```
amd-ai-worker1:~/work/llama.cpp-vulkan$ build/bin/llama-bench -ngl 93 --model /mnt/data/models/llama.cpp/common/Qwen3-235B-A22B-Q3_K_S-00001-of-00003.gguf
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat
```

| model                           |      size |   params | backend | ngl |  test |          t/s |
| ------------------------------- | --------: | -------: | ------- | --: | ----: | -----------: |
| qwen3moe 235B.A22B Q3_K - Small | 94.47 GiB | 235.09 B | Vulkan  |  93 | pp512 | 16.39 ± 0.03 |
| qwen3moe 235B.A22B Q3_K - Small | 94.47 GiB | 235.09 B | Vulkan  |  93 | tg128 | 14.18 ± 0.28 |

### その他主要モデル

```
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat
```

| model                          |      size |  params | backend | ngl |  test |            t/s |
| ------------------------------ | --------: | ------: | ------- | --: | ----: | -------------: |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 | pp512 |   71.98 ± 0.20 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 | tg128 |   72.01 ± 0.09 |
| qwen3 32B Q4_K - Medium        | 18.40 GiB | 32.76 B | Vulkan  |  99 | pp512 |  140.48 ± 2.20 |
| qwen3 32B Q4_K - Medium        | 18.40 GiB | 32.76 B | Vulkan  |  99 | tg128 |   10.42 ± 0.00 |
| qwen3moe 30B.A3B Q8_0          | 33.51 GiB | 30.53 B | Vulkan  |  99 | pp512 |   72.65 ± 0.22 |
| qwen3moe 30B.A3B Q8_0          | 33.51 GiB | 30.53 B | Vulkan  |  99 | tg128 |   29.87 ± 0.11 |
| llama 7B Q4_K - Medium         |  3.80 GiB |  6.74 B | Vulkan  |  99 | pp512 | 672.08 ± 23.88 |
| llama 7B Q4_K - Medium         |  3.80 GiB |  6.74 B | Vulkan  |  99 | tg128 |   46.26 ± 0.11 |
| llama 7B Q4_0                  |  3.56 GiB |  6.74 B | Vulkan  |  99 | pp512 | 822.14 ± 29.33 |
| llama 7B Q4_0                  |  3.56 GiB |  6.74 B | Vulkan  |  99 | tg128 |   49.35 ± 0.07 |

```
build: c531edfa (5398)
```

# batch size ごとに prompt processing の速度を検証

気がついたが、qwen3moe 系の`prompt processing`が遅い問題があり、batch size を変えてみたら速くなったりしたので、 batchsize を変えてみて検証

```
amd-ai-worker1:~/work/llama.cpp-vulkan$ build/bin/llama-bench --batch-size 1280,640,320,240,120,60,1,0  -ngl 99 -m /mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-UD-Q4_K_XL.gguf
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat
```

| model                          |      size |  params | backend | ngl | n_batch |  test |           t/s |
| ------------------------------ | --------: | ------: | ------- | --: | ------: | ----: | ------------: |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |    1280 | pp512 |  72.15 ± 0.25 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |    1280 | tg128 |  71.97 ± 0.07 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     640 | pp512 |  72.08 ± 0.25 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     640 | tg128 |  71.87 ± 0.10 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     320 | pp512 | 117.38 ± 0.38 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     320 | tg128 |  72.00 ± 0.07 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     240 | pp512 | 120.95 ± 0.50 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     240 | tg128 |  72.07 ± 0.04 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     120 | pp512 | 169.14 ± 1.98 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     120 | tg128 |  72.05 ± 0.03 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |      60 | pp512 | 155.52 ± 3.49 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |      60 | tg128 |  72.19 ± 0.05 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |       1 | pp512 |  70.78 ± 0.03 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |       1 | tg128 |  72.12 ± 0.06 |

このあと segfault で死んだが、 reddit によると、vulkan バックエンドの場合バッチサイズ 365 以上にするとぶっ飛ぶらしい

https://www.reddit.com/r/LocalLLaMA/comments/1kd5rua/qwen3_235ba22b_on_a_windows_tablet_111ts_on_amd/

## ちょっと長いコンテキストの場合

```
amd-ai-worker1:~/work/llama.cpp-vulkan$ build/bin/llama-bench --batch-size 320,240,120,60,1,0 -p 4096 -n 512 -ngl 99 -m /mnt/data/models/llama.cpp/common/Qwen3-30B-A3B-UD-Q4_K_XL.gguf
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat
```

| model                          |      size |  params | backend | ngl | n_batch |   test |           t/s |
| ------------------------------ | --------: | ------: | ------- | --: | ------: | -----: | ------------: |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     320 | pp4096 |  99.75 ± 0.22 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     320 |  tg512 |  70.71 ± 0.08 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     240 | pp4096 | 112.04 ± 0.43 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     240 |  tg512 |  70.62 ± 0.04 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     120 | pp4096 | 153.81 ± 0.65 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |     120 |  tg512 |  70.62 ± 0.05 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |      60 | pp4096 | 145.02 ± 0.63 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |      60 |  tg512 |  70.74 ± 0.02 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |       1 | pp4096 |  57.53 ± 0.16 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan  |  99 |       1 |  tg512 |  70.65 ± 0.02 |

これも Segmentation fault (core dumped)で落ちたが、走り切ってくれた

## batch size 120 でそれぞれの LLM の速度検証

こちらは予想外にも、llama2 7b や Qwen3 32B などの dense モデル系での pp がわずかに遅くなった

これはこれで最適なバッチサイズがありそうだが、少なくとも moe モデルは 120 あたりにするのが妥当か

ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon Graphics (RADV GFX1151) (radv) | uma: 1 | fp16: 1 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat
| model | size | params | backend | ngl | n_batch | test | t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | --------------: | -------------------: |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan | 99 | 120 | pp512 | 168.89 ± 1.09 |
| qwen3moe 30B.A3B Q4_K - Medium | 16.49 GiB | 30.53 B | Vulkan | 99 | 120 | tg128 | 71.86 ± 0.27 |
| qwen3 32B Q4_K - Medium | 18.40 GiB | 32.76 B | Vulkan | 99 | 120 | pp512 | 127.39 ± 1.97 |
| qwen3 32B Q4_K - Medium | 18.40 GiB | 32.76 B | Vulkan | 99 | 120 | tg128 | 10.60 ± 0.01 |
| qwen3moe 30B.A3B Q8_0 | 33.51 GiB | 30.53 B | Vulkan | 99 | 120 | pp512 | 175.26 ± 1.88 |
| qwen3moe 30B.A3B Q8_0 | 33.51 GiB | 30.53 B | Vulkan | 99 | 120 | tg128 | 29.97 ± 0.01 |
| llama 7B Q4_K - Medium | 3.80 GiB | 6.74 B | Vulkan | 99 | 120 | pp512 | 587.71 ± 31.26 |
| llama 7B Q4_K - Medium | 3.80 GiB | 6.74 B | Vulkan | 99 | 120 | tg128 | 46.15 ± 0.05 |
| llama 7B Q4_0 | 3.56 GiB | 6.74 B | Vulkan | 99 | 120 | pp512 | 744.30 ± 28.18 |
| llama 7B Q4_0 | 3.56 GiB | 6.74 B | Vulkan | 99 | 120 | tg128 | 49.87 ± 0.35 |

build: c531edfa (5398)

# 失敗例

ビルドする時に、ドキュメントの環境変数をそのままぶち込んでしまった例

GPU_TARGETS が gfx1030 になってしまっており、これでは動かない

```
HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" \
    cmake -S . -B build -DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1030 -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -- -j 16

# ログ
-- Warning: ccache not found - consider installing it for faster compilation or disable this warning with GGML_CCACHE=OFF
-- CMAKE_SYSTEM_PROCESSOR: x86_64
-- Including CPU backend
-- x86 detected
-- Adding CPU backend variant ggml-cpu: -march=native
CMake Warning (dev) at /opt/rocm/lib/cmake/hip/hip-config-amd.cmake:70 (message):
  AMDGPU_TARGETS is deprecated.  Please use GPU_TARGETS instead.
Call Stack (most recent call first):
  /opt/rocm/lib/cmake/hip/hip-config.cmake:149 (include)
  ggml/src/ggml-hip/CMakeLists.txt:39 (find_package)
This warning is for project developers.  Use -Wno-dev to suppress it.

-- HIP and hipBLAS found
-- Including HIP backend
-- Found CURL: /usr/lib/x86_64-linux-gnu/libcurl.so (found version "8.5.0")
-- Configuring done (0.3s)
-- Generating done (0.1s)
-- Build files have been written to: /home/amemiya/work/llama.cpp/build

......

[ 99%] Built target test-chat
[ 99%] Linking CXX executable ../bin/test-backend-ops
[ 99%] Built target test-backend-ops
[ 99%] Linking CXX executable ../../bin/llama-bench
[ 99%] Built target llama-bench
[ 99%] Linking CXX executable ../../bin/llama-tts
[ 99%] Built target llama-tts
[100%] Linking CXX executable ../../bin/llama-server
[100%] Built target llama-server
```

見た感じ、build/bin/にお目当てのバイナリがありそうなので、そこを叩く

だが、うまく動かない。

```
amd-ai-worker1:~/work/llama.cpp$ build/bin/llama-cli -ngl 29  -hf unsloth/Qwen3-0.6B-GGUF:Q8_0
ggml_cuda_init: GGML_CUDA_FORCE_MMQ:    no
ggml_cuda_init: GGML_CUDA_FORCE_CUBLAS: no
ggml_cuda_init: found 1 ROCm devices:
  Device 0: AMD Radeon Graphics, gfx1151 (0x1151), VMM: no, Wave Size: 32
curl_perform_with_retry: HEAD https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf (attempt 1 of 1)...
common_download_file_single: using cached file: /home/amemiya/.cache/llama.cpp/unsloth_Qwen3-0.6B-GGUF_Qwen3-0.6B-Q8_0.gguf
build: 5398 (c531edfa) with cc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0 for x86_64-linux-gnu
main: llama **backend** init
main: load the model and apply lora adapter, if any
llama_model_load_from_file_impl: using device ROCm0 (AMD Radeon Graphics) - 65380 MiB free
llama_model_loader: loaded meta data with 32 key-value pairs and 310 tensors from /home/amemiya/.cache/llama.cpp/unsloth_Qwen3-0.6B-GGUF_Qwen3-0.6B-Q8_0.gguf (version GGUF V3 (latest))
llama_model_loader: Dumping metadata keys/values. Note: KV overrides do not apply in this output.
llama_model_loader: - kv   0:                       general.architecture str              = qwen3
llama_model_loader: - kv   1:                               general.type str              = model
llama_model_loader: - kv   2:                               general.name str              = Qwen3-0.6B
llama_model_loader: - kv   3:                           general.basename str              = Qwen3-0.6B
llama_model_loader: - kv   4:                       general.quantized_by str              = Unsloth
llama_model_loader: - kv   5:                         general.size_label str              = 0.6B
llama_model_loader: - kv   6:                           general.repo_url str              = https://huggingface.co/unsloth
llama_model_loader: - kv   7:                          qwen3.block_count u32              = 28
llama_model_loader: - kv   8:                       qwen3.context_length u32              = 40960
llama_model_loader: - kv   9:                     qwen3.embedding_length u32              = 1024
llama_model_loader: - kv  10:                  qwen3.feed_forward_length u32              = 3072
llama_model_loader: - kv  11:                 qwen3.attention.head_count u32              = 16
llama_model_loader: - kv  12:              qwen3.attention.head_count_kv u32              = 8
llama_model_loader: - kv  13:                       qwen3.rope.freq_base f32              = 1000000.000000
llama_model_loader: - kv  14:     qwen3.attention.layer_norm_rms_epsilon f32              = 0.000001
llama_model_loader: - kv  15:                 qwen3.attention.key_length u32              = 128
llama_model_loader: - kv  16:               qwen3.attention.value_length u32              = 128
llama_model_loader: - kv  17:                       tokenizer.ggml.model str              = gpt2
llama_model_loader: - kv  18:                         tokenizer.ggml.pre str              = qwen2
llama_model_loader: - kv  19:                      tokenizer.ggml.tokens arr[str,151936]  = ["!", "\"", "#", "$", "%", "&", "'", ...
llama_model_loader: - kv  20:                  tokenizer.ggml.token_type arr[i32,151936]  = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...
llama_model_loader: - kv  21:                      tokenizer.ggml.merges arr[str,151387]  = ["Ġ Ġ", "ĠĠ ĠĠ", "i n", "Ġ t",...
llama_model_loader: - kv  22:                tokenizer.ggml.eos_token_id u32              = 151645
llama_model_loader: - kv  23:            tokenizer.ggml.padding_token_id u32              = 151654
llama_model_loader: - kv  24:               tokenizer.ggml.add_bos_token bool             = false
llama_model_loader: - kv  25:                    tokenizer.chat_template str              = {%- if tools %}\n    {{- '<|im_start|>...
llama_model_loader: - kv  26:               general.quantization_version u32              = 2
llama_model_loader: - kv  27:                          general.file_type u32              = 7
llama_model_loader: - kv  28:                      quantize.imatrix.file str              = Qwen3-0.6B-GGUF/imatrix_unsloth.dat
llama_model_loader: - kv  29:                   quantize.imatrix.dataset str              = unsloth_calibration_Qwen3-0.6B.txt
llama_model_loader: - kv  30:             quantize.imatrix.entries_count i32              = 196
llama_model_loader: - kv  31:              quantize.imatrix.chunks_count i32              = 685
llama_model_loader: - type  f32:  113 tensors
llama_model_loader: - type q8_0:  197 tensors
print_info: file format = GGUF V3 (latest)
print_info: file type   = Q8_0
print_info: file size   = 604.15 MiB (8.50 BPW)
load: special tokens cache size = 26
load: token to piece cache size = 0.9311 MB
print_info: arch             = qwen3
print_info: vocab_only       = 0
print_info: n_ctx_train      = 40960
print_info: n_embd           = 1024
print_info: n_layer          = 28
print_info: n_head           = 16
print_info: n_head_kv        = 8
print_info: n_rot            = 128
print_info: n_swa            = 0
print_info: n_swa_pattern    = 1
print_info: n_embd_head_k    = 128
print_info: n_embd_head_v    = 128
print_info: n_gqa            = 2
print_info: n_embd_k_gqa     = 1024
print_info: n_embd_v_gqa     = 1024
print_info: f_norm_eps       = 0.0e+00
print_info: f_norm_rms_eps   = 1.0e-06
print_info: f_clamp_kqv      = 0.0e+00
print_info: f_max_alibi_bias = 0.0e+00
print_info: f_logit_scale    = 0.0e+00
print_info: f_attn_scale     = 0.0e+00
print_info: n_ff             = 3072
print_info: n_expert         = 0
print_info: n_expert_used    = 0
print_info: causal attn      = 1
print_info: pooling type     = 0
print_info: rope type        = 2
print_info: rope scaling     = linear
print_info: freq_base_train  = 1000000.0
print_info: freq_scale_train = 1
print_info: n_ctx_orig_yarn  = 40960
print_info: rope_finetuned   = unknown
print_info: ssm_d_conv       = 0
print_info: ssm_d_inner      = 0
print_info: ssm_d_state      = 0
print_info: ssm_dt_rank      = 0
print_info: ssm_dt_b_c_rms   = 0
print_info: model type       = 0.6B
print_info: model params     = 596.05 M
print_info: general.name     = Qwen3-0.6B
print_info: vocab type       = BPE
print_info: n_vocab          = 151936
print_info: n_merges         = 151387
print_info: BOS token        = 11 ','
print_info: EOS token        = 151645 '<|im_end|>'
print_info: EOT token        = 151645 '<|im_end|>'
print_info: PAD token        = 151654 '<|vision_pad|>'
print_info: LF token         = 198 'Ċ'
print_info: FIM PRE token    = 151659 '<|fim_prefix|>'
print_info: FIM SUF token    = 151661 '<|fim_suffix|>'
print_info: FIM MID token    = 151660 '<|fim_middle|>'
print_info: FIM PAD token    = 151662 '<|fim_pad|>'
print_info: FIM REP token    = 151663 '<|repo_name|>'
print_info: FIM SEP token    = 151664 '<|file_sep|>'
print_info: EOG token        = 151643 '<|endoftext|>'
print_info: EOG token        = 151645 '<|im_end|>'
print_info: EOG token        = 151662 '<|fim_pad|>'
print_info: EOG token        = 151663 '<|repo_name|>'
print_info: EOG token        = 151664 '<|file_sep|>'
print_info: max token length = 256
load_tensors: loading model tensors, this can take a while... (mmap = true)
load_tensors: offloading 28 repeating layers to GPU
load_tensors: offloading output layer to GPU
load_tensors: offloaded 29/29 layers to GPU
load_tensors:        ROCm0 model buffer size =   604.15 MiB
load_tensors:   CPU_Mapped model buffer size =   157.65 MiB
.............................................................
llama_context: constructing llama_context
llama_context: n_seq_max     = 1
llama_context: n_ctx         = 4096
llama_context: n_ctx_per_seq = 4096
llama_context: n_batch       = 2048
llama_context: n_ubatch      = 512
llama_context: causal_attn   = 1
llama_context: flash_attn    = 0
llama_context: freq_base     = 1000000.0
llama_context: freq_scale    = 1
llama_context: n_ctx_per_seq (4096) < n_ctx_train (40960) -- the full capacity of the model will not be utilized
llama_context:  ROCm_Host  output buffer size =     0.58 MiB
llama_kv_cache_unified: kv_size = 4096, type_k = 'f16', type_v = 'f16', n_layer = 28, can_shift = 1, padding = 32
llama_kv_cache_unified:      ROCm0 KV buffer size =   448.00 MiB
llama_kv_cache_unified: KV self size  =  448.00 MiB, K (f16):  224.00 MiB, V (f16):  224.00 MiB
llama_context:      ROCm0 compute buffer size =   298.75 MiB
llama_context:  ROCm_Host compute buffer size =    10.01 MiB
llama_context: graph nodes  = 1070
llama_context: graph splits = 2
common_init_from_params: setting dry_penalty_last_n to ctx_size = 4096
common_init_from_params: warming up the model with an empty run - please wait ... (--no-warmup to disable)
/home/amemiya/work/llama.cpp/ggml/src/ggml-cuda/ggml-cuda.cu:75: ROCm error
ggml_cuda_compute_forward: RMS_NORM failed
ROCm error: invalid device function
  current device: 0, in function ggml_cuda_compute_forward at /home/amemiya/work/llama.cpp/ggml/src/ggml-cuda/ggml-cuda.cu:2359
  err
Could not attach to process.  If your uid matches the uid of the target
process, check the setting of /proc/sys/kernel/yama/ptrace_scope, or try
again as the root user.  For more details, see /etc/sysctl.d/10-ptrace.conf
ptrace: Operation not permitted.
No stack.
The program is not being run.
Aborted (core dumped)
```
