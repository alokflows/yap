# Yap helper — runs invisibly in the background. A mouth icon sits in the
# system tray (bottom-right by the clock); right-click it to change the code or
# quit. There is no window to close — closing nothing keeps it running.

# Hide our own console window immediately, so nothing visible lingers even if
# the launcher's -WindowStyle Hidden is ignored by the system.
Add-Type -Name Win -Namespace Yap -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);'
$null = [Yap.Win]::ShowWindow([Yap.Win]::GetConsoleWindow(), 0)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
$server = 'https://yap-mkk4.onrender.com'

function Get-Code {
  $c = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the pairing code shown in the Yap app:', 'Yap', '')
  return (($c -as [string]).ToUpper() -replace '[^A-Z0-9]', '')
}

# The code is baked in by the download. If it is missing or invalid, ask once.
$script:code = ('__CODE__'.ToUpper() -replace '[^A-Z0-9]', '')
if ($script:code.Length -lt 3) { $script:code = Get-Code }
if ($script:code.Length -lt 3) { exit }

function Reset-Baseline {
  # Skip whatever is already in the session so only new sends paste from here on.
  $script:last = 0
  try {
    $j = Invoke-RestMethod "$server/poll/$($script:code)/0"
    if ($j.messages) { $script:last = ($j.messages | Measure-Object -Property id -Maximum).Maximum }
  } catch {}
}
Reset-Baseline

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = [System.Drawing.SystemIcons]::Application
$ni.Visible = $true
$ni.Text = "Yap - connected ($($script:code))"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$change = $menu.Items.Add('Change code...')
$change.add_Click({
  $c = Get-Code
  if ($c.Length -ge 3) {
    $script:code = $c
    Reset-Baseline
    $ni.Text = "Yap - connected ($($script:code))"
    $ni.ShowBalloonTip(3000, 'Yap', "Now connected to $($script:code).", [System.Windows.Forms.ToolTipIcon]::Info)
  }
})
$quit = $menu.Items.Add('Quit Yap')
$quit.add_Click({ $ni.Visible = $false; $timer.Stop(); [System.Windows.Forms.Application]::Exit() })
$ni.ContextMenuStrip = $menu
$ni.ShowBalloonTip(4000, 'Yap', "Connected to $($script:code). Send from your phone - it pastes here. Right-click the tray icon to change the code or quit.", [System.Windows.Forms.ToolTipIcon]::Info)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 800
$timer.add_Tick({
  try {
    $r = Invoke-RestMethod "$server/poll/$($script:code)/$($script:last)"
    foreach ($m in $r.messages) {
      [System.Windows.Forms.Clipboard]::SetText($m.text)
      $script:last = $m.id
      [System.Windows.Forms.SendKeys]::SendWait('^v')
    }
  } catch {}
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
