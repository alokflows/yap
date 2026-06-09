# Yap helper for Windows — pastes straight at your cursor.
#
# This runs in a plain, visible window. It asks once for your pairing code,
# then keeps running: every message you send from your phone is copied here
# and pasted at your cursor. Nothing is hidden and nothing is installed —
# close the window to stop it.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
$server = 'https://yap-mkk4.onrender.com'

# The download leaves this blank, so the box below asks for your code.
$code = ('__CODE__'.ToUpper() -replace '[^A-Z0-9]', '')
while ($code.Length -lt 3) {
  $entry = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the pairing code shown in the Yap app:', 'Yap', '')
  if ($null -eq $entry -or $entry -eq '') { exit }
  $code = ($entry.ToUpper() -replace '[^A-Z0-9]', '')
}

Write-Host ''
Write-Host "  Yap connected to $code" -ForegroundColor Green
Write-Host '  Click into the app where you want the text to land,'
Write-Host '  then send from your phone - it pastes at your cursor.'
Write-Host '  Keep this window open. Close it to stop Yap.'
Write-Host ''

# Skip whatever is already in the session, so only new messages paste from now.
$last = 0
try {
  $j = Invoke-RestMethod ("{0}/poll/{1}/0" -f $server, $code)
  if ($j.messages) { $last = ($j.messages | Measure-Object -Property id -Maximum).Maximum }
} catch {}

while ($true) {
  try {
    $r = Invoke-RestMethod ("{0}/poll/{1}/{2}?wait=25" -f $server, $code, $last)
    foreach ($m in $r.messages) {
      [System.Windows.Forms.Clipboard]::SetText($m.text)
      $last = $m.id
      Start-Sleep -Milliseconds 120
      [System.Windows.Forms.SendKeys]::SendWait('^v')
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}
