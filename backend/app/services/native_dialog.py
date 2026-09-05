"""
Native file/folder dialogs for the local backend process.

Browsers cannot expose real disk paths from <input type=file>.
Since PMVForge's API runs on the same machine as the files, we open
OS dialogs from Python and return absolute paths — zero uploading.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from typing import List, Optional, Sequence, Tuple


def _tk_pick(
    mode: str,
    title: str,
    filetypes: Optional[Sequence[Tuple[str, str]]] = None,
    multiple: bool = False,
    initialdir: Optional[str] = None,
) -> List[str]:
    """mode: 'file' | 'files' | 'folder' | 'save'"""
    import tkinter as tk
    from tkinter import filedialog

    result: List[str] = []

    def _run():
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        kwargs = {}
        if title:
            kwargs["title"] = title
        if initialdir:
            kwargs["initialdir"] = initialdir
        if filetypes:
            kwargs["filetypes"] = list(filetypes) + [("All files", "*.*")]

        if mode == "folder":
            path = filedialog.askdirectory(**kwargs)
            if path:
                result.append(path)
        elif mode == "files":
            paths = filedialog.askopenfilenames(**kwargs)
            result.extend(paths or [])
        elif mode == "save":
            path = filedialog.askdirectory(**kwargs)  # output folder
            if path:
                result.append(path)
        else:
            path = filedialog.askopenfilename(**kwargs)
            if path:
                result.append(path)
        root.destroy()

    # tk must run on main thread on some platforms; try direct first
    try:
        _run()
    except Exception:
        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join(timeout=300)
    return result


def _win_folder(title: str) -> List[str]:
    ps = f"""
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '{title.replace("'", "''")}'
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
  Write-Output $d.SelectedPath
}}
"""
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=300,
        )
        path = (r.stdout or "").strip()
        return [path] if path else []
    except Exception:
        return []


def _win_files(title: str, filter_str: str, multiple: bool) -> List[str]:
    # filter example: "Beatmaps (*.osu;*.txt)|*.osu;*.txt|All|*.*"
    multi = "$true" if multiple else "$false"
    ps = f"""
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Title = '{title.replace("'", "''")}'
$f.Filter = '{filter_str.replace("'", "''")}'
$f.Multiselect = {multi}
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
  $f.FileNames | ForEach-Object {{ Write-Output $_ }}
}}
"""
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=300,
        )
        lines = [ln.strip() for ln in (r.stdout or "").splitlines() if ln.strip()]
        return lines
    except Exception:
        return []


def pick_folder(title: str = "Select folder") -> Optional[str]:
    paths: List[str] = []
    try:
        paths = _tk_pick("folder", title)
    except Exception:
        paths = []
    if not paths and os.name == "nt":
        paths = _win_folder(title)
    return paths[0] if paths else None


def pick_file(
    title: str = "Select file",
    filetypes: Optional[Sequence[Tuple[str, str]]] = None,
) -> Optional[str]:
    paths: List[str] = []
    try:
        paths = _tk_pick("file", title, filetypes=filetypes)
    except Exception:
        paths = []
    if not paths and os.name == "nt":
        # Build WinForms filter from filetypes
        if filetypes:
            parts = []
            for label, pattern in filetypes:
                parts.append(f"{label}|{pattern.replace(' ', '')}")
            parts.append("All files|*.*")
            filt = "|".join(parts)
        else:
            filt = "All files|*.*"
        paths = _win_files(title, filt, multiple=False)
    return paths[0] if paths else None


def pick_files(
    title: str = "Select files",
    filetypes: Optional[Sequence[Tuple[str, str]]] = None,
) -> List[str]:
    paths: List[str] = []
    try:
        paths = _tk_pick("files", title, filetypes=filetypes, multiple=True)
    except Exception:
        paths = []
    if not paths and os.name == "nt":
        if filetypes:
            parts = []
            for label, pattern in filetypes:
                parts.append(f"{label}|{pattern.replace(' ', '')}")
            parts.append("All files|*.*")
            filt = "|".join(parts)
        else:
            filt = "Video|*.mp4;*.mov;*.mkv;*.webm;*.avi;*.wmv;*.m4v|All|*.*"
        paths = _win_files(title, filt, multiple=True)
    return paths
