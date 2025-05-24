---
title: GMKTec EVO X2のBIOS アップデート(非Windows)
author: amemiya
pubDatetime: 2025-05-16T10:00:00Z
postSlug: gmktec-ryzen-ai-pc-bios-update
featured: true
draft: false
tags:
  - ryzenai
  - amd
  - amdgpu
  - gpu
  - npu
  - bios
  - 96GB
  - ll
ogImage: ""
description: GMKTEcのAI PCをセットアップして、GPUのベンチマークを取ってみた
canonicalURL: https://blog.tosukui.xyz/posts/gmktec-ryzen-ai-pc-setup
---

- [EVO X2 の BIOS アップデート(非 Windows)](#evo-x2-の-bios-アップデート非-windows)
  - [1. EFI ブートできる USB を用意する(別の端末で実施)](#1-efi-ブートできる-usb-を用意する別の端末で実施)
    - [準備するもの](#準備するもの)
    - [手順](#手順)
  - [2. EVO X2 での BIOS アップデート手順](#2-evo-x2でのbiosアップデート手順)
    - [手順](#手順-1)

# EVO X2 の BIOS アップデート(非 Windows)

## 1. EFI ブートできる USB を用意する(別の端末で実施)

### 準備するもの

- FAT32 フォーマット済みのフラッシュメモリ

### 手順

1. **EFI シェルファイルをダウンロード**
   - [Shell_Full.efi](https://github.com/tianocore/edk2-archive/blob/master/EdkShellBinPkg/FullShell/X64/Shell_Full.efi) をダウンロード
   - ファイル名を `shellx64.efi` に変更（BIOS から認識可能にするため）
   - USB ストレージルートにコピーする
2. **GMKTEC の BIOS アップデートファイルを取得**
   - 公式サイトのダウンロード先: [GMKTEC ドライバページ](https://www.gmktec.com/pages/drivers-and-software)
   - ダウンロード後、解凍して以下のディレクトリを USB ストレージルートにコピー
     - `ROM`
     - `Shell`
3. **USB 内のディレクトリ構成**
   ```
   USBストレージルート
   ├── shellx64.efi        # EFIシェル本体
   └── ROM                # BIOS更新ファイル
   │   └── AXB3502104.bin
   └── Shell              # 更新スクリプト
       ├── AfuEfix64.efi
       ├── AXB35-02_BIOS_UpdateEFI.nsh
       └── readme.txt
   ```

## 2. EVO X2 での BIOS アップデート手順

### 手順

1. **先ほど作った USB ストレージを EVO X2 に挿す**
2. **BIOS 設定画面にアクセス**

   - PC 起動時に **ESC キーを連打** して BIOS 画面へ

3. **EFI Shell を起動**

   - 以下を選択:
     `Launch EFI Shell from filesystem device`
     ![EFI起動選択](/assets/launch_efi.png)

4. **シェル EFI が起動したあと、USB デバイスをマウント**

   - シェル画面で以下を実行:
     ```
     Shell> fs1:
     ```
   - ※ `fs1`が USB デバイス（"removable blockdevice"と表示される）の場合の例です
     - ![efishell](/assets/efishell.png)

5. **BIOS 更新スクリプトを実行**

   ```bash
   Shell> cd Shell        # Shellディレクトリへ移動
   Shell> AXB35-02_BIOS_UpdateEFI.nsh  # 更新スクリプトを実行
   ```

   ![更新実行画面](/assets/nsh.png)

6. **更新中の注意点**

   - bios のアップデート中はコケたら文鎮確定なので、できるだけ揺らさないよう細心の注意を払って生活する
   - 絶対に電源を切らないようにする
   - だいたい 6 分後に自動シャットダウンするので → 再起動で更新完了

7. **BIOS 設定の最適化（推奨）**
   - BIOS 画面で以下を設定:
     ```
     GFX Configuration > iGPU Configuration > [UMA_SPECIFIED]
     UMA Frame buffer size > [96G]
     ```
   - ![GPUメモリ設定](/assets/gfx.png)
   - ![96GB設定画面](/assets/96g.png)
