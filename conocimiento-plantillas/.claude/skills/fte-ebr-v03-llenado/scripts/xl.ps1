param([string]$In, [string]$Out, [string]$Values, [string]$ReadSpec, [string]$ReadOut)
# Escribe valores en un libro con Excel (conserva validaciones, formatos y fórmulas),
# recalcula, guarda y devuelve en JSON las celdas pedidas.
$ErrorActionPreference = 'Stop'
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false; $xl.EnableEvents = $false
try {
  $wb = $xl.Workbooks.Open($In, 0, $false)
  $xl.Calculation = -4135   # manual mientras escribimos
  if ($Values) {
    $skipped = @()
    $vals = Get-Content -Raw -Encoding UTF8 $Values | ConvertFrom-Json
    foreach ($v in $vals) {
      $ws = $wb.Worksheets.Item([string]$v[0])
      $rng = $ws.Range([string]$v[1])
      if ($ws.ProtectContents -and $rng.MergeArea.Locked) { $skipped += ($v[0] + '!' + $v[1]); continue }
      try { $val = $v[2]; if ($val -is [string]) { $rng.Value2 = [string]$val } else { $rng.Value2 = [double]$val } } catch { throw ("Fallo en " + $v[0] + "!" + $v[1] + ": " + $_) }
    }
  }
  $xl.CalculateFull()
  if ($skipped) { 'BLOQUEADAS: ' + ($skipped -join ', ') }
  $res = @{}
  if ($ReadSpec) {
    $spec = Get-Content -Raw -Encoding UTF8 $ReadSpec | ConvertFrom-Json
    foreach ($r in $spec) {
      $ws = $wb.Worksheets.Item([string]$r[0])
      $rng = $ws.Range([string]$r[1])
      $rows = @()
      foreach ($row in $rng.Rows) {
        $cells = @()
        foreach ($c in $row.Cells) { $cells += ,$c.Value2 }
        $rows += ,$cells
      }
      $res[$r[0] + '!' + $r[1]] = $rows
    }
  }
  $xl.Calculation = -4105
  if ($Out) {
    if (Test-Path $Out) { Remove-Item $Out -Force }
    $wb.SaveAs($Out, 51)
  }
  $wb.Close($false)
  if ($ReadOut) { $res | ConvertTo-Json -Depth 6 -Compress | Out-File -Encoding utf8 $ReadOut }
}
finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
