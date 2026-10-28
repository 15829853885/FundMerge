; ============================================================================
; FundMerge（合资金账）安装器定制
;
; 背景：electron-builder 默认卸载脚本执行 `RMDir /r $INSTDIR`，
;       而本产品把账本放在 <安装目录>\data —— 覆盖安装（先跑旧卸载器）会连账本一起删掉。
;
; 方案：卸载/升级前把 data 目录移出 $INSTDIR，删完再移回。
; 三个必须防住的窗口（本文件已处理）：
;   窗口 A：$TEMP 里上次升级的残留被无条件删除 → 改为改名保留
;   窗口 B：数据已移出、尚未移回的间隙断电 → 写 fm-moving.flag，启动时可恢复
;   窗口 C：移回失败导致数据停在 $TEMP → 用复制兜底 + 标记文件
; ============================================================================

!macro customRemoveFiles
  SetOutPath $TEMP

  ; ---------- 1. 把账本移到临时区 ----------
  IfFileExists "$INSTDIR\data\*.*" 0 fm_skip_move

    ; 上次升级若残留了数据，改名保留而不是删掉（窗口 A）
    IfFileExists "$TEMP\fm-keep-data\*.*" 0 +2
      Rename "$TEMP\fm-keep-data" "$TEMP\fm-keep-data-prev"

    ClearErrors
    Rename "$INSTDIR\data" "$TEMP\fm-keep-data"
    IfErrors 0 fm_moved
      ; 重命名失败（被占用）：退化为复制
      CreateDirectory "$TEMP\fm-keep-data"
      CopyFiles /SILENT "$INSTDIR\data\*.*" "$TEMP\fm-keep-data"

    fm_moved:
    ; 标记「数据已移出、尚未移回」，供启动时检测（窗口 B）
    FileOpen $0 "$TEMP\fm-moving.flag" w
    FileWrite $0 "$INSTDIR"
    FileClose $0

  fm_skip_move:

  ; ---------- 2. 删除安装目录其余内容 ----------
  RMDir /r "$INSTDIR"

  ; ---------- 3. 把账本放回 ----------
  IfFileExists "$TEMP\fm-keep-data\*.*" 0 fm_skip_restore
    CreateDirectory "$INSTDIR"
    ClearErrors
    Rename "$TEMP\fm-keep-data" "$INSTDIR\data"
    IfErrors 0 fm_restored
      ; 移回失败：复制兜底（窗口 C）
      CreateDirectory "$INSTDIR\data"
      CopyFiles /SILENT "$TEMP\fm-keep-data\*.*" "$INSTDIR\data"

    fm_restored:
    Delete "$TEMP\fm-moving.flag"

  fm_skip_restore:

  ; ---------- 4. 数据目录位置标记 ----------
  IfFileExists "$INSTDIR\data" 0 fm_skip_mark
    FileOpen $0 "$INSTDIR\data-location.txt" w
    FileWrite $0 "$INSTDIR\data"
    FileClose $0

  fm_skip_mark:
!macroend
