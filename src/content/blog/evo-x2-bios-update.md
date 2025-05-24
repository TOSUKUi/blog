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
  - [別の端末で EFI ブートできる USB を用意する](#別の端末で-efi-ブートできる-usb-を用意する)
  - [EVO X2 に挿して BIOS アップデートする](#evo-x2-に挿して-bios-アップデートする)

# EVO X2 の BIOS アップデート(非 Windows)

## 別の端末で EFI ブートできる USB を用意する

※EFI ブートとは USB から OS や BIOS など低レイヤーに色々アクセスできる別の BIOS のようなものだと思って貰えば

1. まず USB フラッシュメモリを用意し、FAT32 でフォーマット
2. ここのファイルをダウンロードし、ルートディレクトリに放り込む
   - https://github.com/tianocore/edk2-archive/blob/master/EdkShellBinPkg/FullShell/X64/Shell_Full.efi
   - 名前を shellx64.efi と変更(これにより BIOS から起動できるようになる)
3. ここから GMKTEC の BIOS アップデートイメージをダウンロードする
   - https://www.gmktec.com/pages/drivers-and-software
4. 展開
5. `ROM`ディレクトリと、`Shell`ディレクトリをそのままルートディレクトリに放り込む
   - ディレクトリ構成
   ```
   % tree
   USBフラッシュメモリルート
   ├── shellx64.efi
   ├── ROM
   │   └── AXB3502104.bin
   └── Shell
       ├── AfuEfix64.efi
       ├── AXB35-02_BIOS_UpdateEFI.nsh
       └── readme.txt
   ```

## EVO X2 に挿して BIOS アップデートする

1. PC を起動し、ESC を連打して BIOS に入る
2. Launch EFI Shell from filesystem device を選択
   ![launchefi](/assets/launch_efi.png)
3. シェル efi が起動する。USB 内部のインストールコマンドを打ちたいので、まず USB デバイスを選択する
   - ![efishell](/assets/efishell.png)
4. `Shell> fs1:`を入力し、ワーキングスペースとして USB デバイスを選択する
   - 今回は fs1 が`removable blockdevice`だの USB だの書いてあるので`fs1`とした
5. BIOS インストーラを実行

   ```
   > cd Shell # Shellディレクトリに移動
   > AXB35-02_BIOS_UpdateEFI.nsh # BIOSインストーラ起動
   ```

   ![nsh](/assets/nsh.png)

6. bios のアップデート中はコケたら文鎮確定なので、できるだけ揺らさないよう細心の注意を払って生活する。

   - 大体 6 分くらいでインストールが終わり、いきなりブチっと電源が切れる。

7. そのまま起動するとアップデートが完了しているので、BIOS に入り、`GFX configration` > `igpu configration` > `[UMA_SPECIFIED]`に変更し、`UMA Frame buffer size`を 96G に変更すると GPU メモリ割り当てを 96G にできる
   ![gfx](/assets/gfx.png)
   ![96g](/assets/96g.png)
