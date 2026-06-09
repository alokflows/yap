# Yap helper for Windows — pastes straight at your cursor.
#
# Runs in a plain, visible window. Nothing is hidden and nothing is installed.
# It asks for your pairing code, then every message you send from your phone is
# copied here and pasted at your cursor. Leave the window open; close it (or
# press Ctrl-C) to stop.

Add-Type -AssemblyName System.Windows.Forms
$server = 'https://yap-mkk4.onrender.com'

# The download leaves this blank, so we ask for the code here.
$code = ('__CODE__'.ToUpper() -replace '[^A-Z0-9]', '')
while ($code.Length -lt 3) {
  $entry = Read-Host 'Enter the pairing code shown in the Yap app'
  $code = ($entry.ToUpper() -replace '[^A-Z0-9]', '')
}

Write-Host ''
Write-Host "  Connected to code $code." -ForegroundColor Green
Write-Host '  Click into the app where you want the text to land,'
Write-Host '  then send from your phone - it pastes at your cursor.'
Write-Host '  Leave this window open. Press Ctrl-C or close it to stop.'
Write-Host ''

# Skip whatever is already in the session, so only new messages paste from now.
$last = 0
try {
  $j = Invoke-RestMethod ("{0}/poll/{1}/0" -f $server, $code)
  if ($j.messages) { $last = ($j.messages | Measure-Object -Property id -Maximum).Maximum }
} catch {}

# Long-poll: the server returns the instant a message arrives, so latency is the
# network round-trip, not a fixed poll interval — same speed as the first build.
while ($true) {
  try {
    $r = Invoke-RestMethod ("{0}/poll/{1}/{2}?wait=30" -f $server, $code, $last)
    foreach ($m in $r.messages) {
      [System.Windows.Forms.Clipboard]::SetText($m.text)
      $last = $m.id
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      Write-Host ("  pasted #{0}" -f $m.id)
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}
