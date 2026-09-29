# Registrar GastroManager como tarea de inicio de Windows
$batPath = 'C:\Users\Administrador\Documents\Sistema de gesti\u00f3n gastronomico\iniciar-gastromanager.bat'

$action   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$batPath`""
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask `
  -TaskName   'GastroManager' `
  -Action     $action `
  -Trigger    $trigger `
  -Settings   $settings `
  -RunLevel   Highest `
  -Force

Write-Host "Tarea GastroManager registrada correctamente."
