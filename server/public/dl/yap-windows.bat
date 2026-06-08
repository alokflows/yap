@echo off
REM Yap helper for Windows - double-click to run.
REM Every message you send from the phone lands on your clipboard, so you can
REM press Ctrl-V anywhere. It also auto-pastes into the active window.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s='https://yap-mkk4.onrender.com';" ^
  "$c=(Read-Host 'Enter the pairing code shown in the Yap phone app').ToUpper() -replace '[^A-Z0-9]','';" ^
  "if($c.Length -lt 3){Write-Host 'That code looks too short.';Start-Sleep 3;exit};" ^
  "Add-Type -AssemblyName System.Windows.Forms;" ^
  "$j=Invoke-RestMethod \"$s/poll/$c/0\";" ^
  "$last=0; if($j.messages){$last=($j.messages | Measure-Object -Property id -Maximum).Maximum};" ^
  "Write-Host \"Connected to code $c. Send from your phone - text is copied here instantly.\";" ^
  "Write-Host 'Press Ctrl-V to paste. Leave this window open; close it to stop.';" ^
  "while($true){ try { $r=Invoke-RestMethod \"$s/poll/$c/$last\"; foreach($m in $r.messages){ Set-Clipboard -Value $m.text; $last=$m.id; [System.Windows.Forms.SendKeys]::SendWait('^v'); Write-Host \"  copied #$($m.id)  (Ctrl-V to paste)\" } } catch {}; Start-Sleep -Milliseconds 1500 }"
endlocal
