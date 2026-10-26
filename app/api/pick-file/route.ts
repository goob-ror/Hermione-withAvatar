import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)

export async function POST(req: NextRequest) {
  try {
    const isWindows = process.platform === 'win32'
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux'

    let selectedPath = ''

    if (isWindows) {
      // Create a temporary ps1 script to reliably invoke the file dialog with STA mode
      const tempScript = path.join(os.tmpdir(), `file_picker_${Date.now()}.ps1`)
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "GGUF Model Files (*.gguf)|*.gguf|All Files (*.*)|*.*"
$dialog.Title = "Select Local Model File (.gguf)"
$dialog.InitialDirectory = [System.IO.Directory]::GetCurrentDirectory()
$dialog.RestoreDirectory = $true
$res = $dialog.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.FileName
} else {
    Write-Output ""
}
`
      fs.writeFileSync(tempScript, psScript, 'utf8')

      try {
        const { stdout } = await execAsync(
          `powershell -NoProfile -ExecutionPolicy Bypass -STA -File "${tempScript}"`
        )
        selectedPath = stdout.trim()
      } finally {
        try {
          fs.unlinkSync(tempScript)
        } catch {}
      }
    } else if (isMac) {
      const { stdout } = await execAsync(
        `osascript -e 'POSIX path of (choose file with prompt "Select Model File (.gguf)" of type {"gguf", "bin"})'`
      )
      selectedPath = stdout.trim()
    } else if (isLinux) {
      try {
        const { stdout } = await execAsync(`zenity --file-selection --title="Select Model File (.gguf)"`)
        selectedPath = stdout.trim()
      } catch {
        // Fallback or cancel
        selectedPath = ''
      }
    }

    if (!selectedPath) {
      return NextResponse.json({ canceled: true })
    }

    const stats = fs.existsSync(/* turbopackIgnore: true */ selectedPath)
      ? fs.statSync(/* turbopackIgnore: true */ selectedPath)
      : null

    return NextResponse.json({
      canceled: false,
      filePath: selectedPath,
      fileName: path.basename(selectedPath),
      size: stats ? stats.size : 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to open file picker', detail: err.message }, { status: 500 })
  }
}
