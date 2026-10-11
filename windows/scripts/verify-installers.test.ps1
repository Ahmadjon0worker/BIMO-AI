[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'verify-installers.ps1') -LibraryOnly
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$testRoot = Assert-WithinRoot (Join-Path $workspace ('tmp/iv/test-' + [Guid]::NewGuid().ToString('N').Substring(0,8))) (Join-Path $workspace 'tmp')
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$checks = 0
function Expect-Failure([scriptblock]$Action, [string]$Label) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert-Verify $failed "Expected rejection: $Label"
    $script:checks++
}
foreach ($unsafe in @('../secret','a/../../secret','C:\secret','\\server\secret','/root','a//b','a/./b')) {
    Expect-Failure { Get-SafeRelativePath $unsafe } "path traversal: $unsafe"
}
Assert-Verify ((Get-SafeRelativePath 'localai-service\runtime\python312._pth') -eq 'localai-service/runtime/python312._pth') 'Relative Windows path normalization failed.'
$checks++
Expect-Failure { Assert-WithinRoot (Join-Path $workspace 'production') (Join-Path $workspace 'tmp') } 'output outside workspace tmp'
foreach ($private in @('localai-service/config.json','localai-service/.env','localai-service/account.session','localai-service/logs/error.txt','localai-service/workspace/secret.txt')) {
    Expect-Failure { Assert-NoPrivatePath $private } "private payload: $private"
}
foreach ($public in @('src/provider_credentials.py','runtime/site-packages/telethon/sessions/sqlite.py')) { [void](Assert-NoPrivatePath $public); $checks++ }
$file = Join-Path $testRoot 'payload.txt'
[IO.File]::WriteAllText($file, 'public payload')
$hash = Get-Sha256 $file
$bytes = (Get-Item -LiteralPath $file).Length
Assert-FileContent $file $bytes $hash 'fixture'
$checks++
Expect-Failure { Assert-FileContent $file ($bytes + 1) $hash 'fixture' } 'changed size'
Expect-Failure { Assert-FileContent $file $bytes ('0' * 64) 'fixture' } 'changed hash'
$manifest = [PSCustomObject]@{ service='coucou-localai-service'; architecture='x64'; python='3.12.14'; no_user_config_or_credentials=$true; file_count=1; total_bytes=$bytes; files=@([PSCustomObject]@{path='src/public.py';bytes=$bytes;sha256=$hash}) }
Assert-RuntimeManifest $manifest
$checks++
$manifest.file_count = 2
Expect-Failure { Assert-RuntimeManifest $manifest } 'manifest count mismatch'
$manifest.file_count = 1
$manifest.total_bytes = $bytes + 1
Expect-Failure { Assert-RuntimeManifest $manifest } 'manifest total bytes mismatch'
$manifest.total_bytes = $bytes
$manifest.files += [PSCustomObject]@{path='src/public.py';bytes=$bytes;sha256=$hash}
$manifest.file_count = 2
$manifest.total_bytes = $bytes * 2
Expect-Failure { Assert-RuntimeManifest $manifest } 'duplicate manifest destination'
$manifest.files = @($manifest.files[0])
$manifest.file_count = 1
$manifest.total_bytes = $bytes
$manifest.files[0].path = '../escape'
Expect-Failure { Assert-RuntimeManifest $manifest } 'manifest escape'
foreach ($machine in @(@{id=0x8664;name='x64'},@{id=0x014c;name='x86'},@{id=0xaa64;name='arm64'})) {
    $pe = [byte[]]::new(128)
    $pe[0]=0x4d; $pe[1]=0x5a; $pe[0x3c]=64
    $pe[64]=0x50; $pe[65]=0x45
    [BitConverter]::GetBytes([UInt16]$machine.id).CopyTo($pe,68)
    $peFile = Join-Path $testRoot ($machine.name + '.exe')
    [IO.File]::WriteAllBytes($peFile,$pe)
    Assert-Verify ((Get-PeArchitecture $peFile) -eq $machine.name) 'PE architecture detection failed.'
    $checks++
}
Expect-Failure { Get-PeArchitecture $file } 'non-PE payload'
$importPe = [byte[]]::new(1024)
$importPe[0]=0x4d; $importPe[1]=0x5a; $importPe[0x3c]=64
$importPe[64]=0x50; $importPe[65]=0x45
[BitConverter]::GetBytes([UInt16]0x8664).CopyTo($importPe,68)
[BitConverter]::GetBytes([UInt16]1).CopyTo($importPe,70)
[BitConverter]::GetBytes([UInt16]240).CopyTo($importPe,84)
[BitConverter]::GetBytes([UInt16]0x20b).CopyTo($importPe,88)
[BitConverter]::GetBytes([UInt64]0x140000000).CopyTo($importPe,112)
[BitConverter]::GetBytes([UInt32]512).CopyTo($importPe,148)
[BitConverter]::GetBytes([UInt32]16).CopyTo($importPe,196)
# Regular imports: section RVA 0x1000; delay imports: RVA 0x1100.
[BitConverter]::GetBytes([UInt32]0x1000).CopyTo($importPe,208)
[BitConverter]::GetBytes([UInt32]40).CopyTo($importPe,212)
[BitConverter]::GetBytes([UInt32]0x1100).CopyTo($importPe,304)
[BitConverter]::GetBytes([UInt32]64).CopyTo($importPe,308)
[BitConverter]::GetBytes([UInt32]512).CopyTo($importPe,336)
[BitConverter]::GetBytes([UInt32]0x1000).CopyTo($importPe,340)
[BitConverter]::GetBytes([UInt32]512).CopyTo($importPe,344)
[BitConverter]::GetBytes([UInt32]512).CopyTo($importPe,348)
[BitConverter]::GetBytes([UInt32]0x1080).CopyTo($importPe,524)
[Text.Encoding]::ASCII.GetBytes('kernel32.dll').CopyTo($importPe,640)
[BitConverter]::GetBytes([UInt32]1).CopyTo($importPe,768)
[BitConverter]::GetBytes([UInt32]0x1180).CopyTo($importPe,772)
[Text.Encoding]::ASCII.GetBytes('vcruntime140.dll').CopyTo($importPe,896)
$importFile = Join-Path $testRoot 'imports.exe'
[IO.File]::WriteAllBytes($importFile,$importPe)
$parsedImports = @(Get-PeImports $importFile)
Assert-Verify ($parsedImports.Count -eq 2 -and $parsedImports -contains 'kernel32.dll' -and $parsedImports -contains 'vcruntime140.dll') 'Regular and delay imports must both be audited.'
$checks++
Assert-OnlyOsDependencies @('kernel32.dll','api-ms-win-crt-runtime-l1-1-0.dll') 'fixture'
$checks++
Expect-Failure { Assert-OnlyOsDependencies @('vcruntime140.dll') 'fixture' } 'VC DLL already present on build PC'
Expect-Failure { Assert-OnlyOsDependencies @('webview2loader.dll') 'fixture' } 'external WebView2 loader'
[BitConverter]::GetBytes([UInt32]2415919104).CopyTo($importPe,772)
[IO.File]::WriteAllBytes($importFile,$importPe)
Expect-Failure { Get-PeImports $importFile } 'invalid delay-import RVA'
$directories = @{ child=[PSCustomObject]@{Name='python';Parent='loop'}; loop=[PSCustomObject]@{Name='runtime';Parent='child'} }
Expect-Failure { Get-MsiDirectoryPath 'child' $directories ([Collections.Generic.HashSet[string]]::new()) } 'cyclic MSI directory'
$pythonPathFile = Join-Path $testRoot 'python312._pth'
[IO.File]::WriteAllLines($pythonPathFile, @('# public embedded paths', '', 'python312.zip', 'site-packages', '../src'))
$pythonPaths = @(Get-EmbeddedPythonPaths $pythonPathFile)
Assert-Verify ($pythonPaths.Count -eq 3 -and ($pythonPaths -join '|') -eq 'python312.zip|site-packages|../src') 'Embedded Python paths must retain values and omit comments/blank lines.'
$checks++
foreach ($entry in $pythonPaths) {
    Assert-Verify (@($entry.PSObject.Properties | Where-Object { $_.Name -in @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider','ReadCount') }).Count -eq 0) 'Report path strings must not carry file-provider metadata.'
}
$checks++
$serializationTimer = [Diagnostics.Stopwatch]::StartNew()
$pathJson = [ordered]@{pythonImportPaths=$pythonPaths} | ConvertTo-Json -Depth 12 -Compress
$serializationTimer.Stop()
Assert-Verify ($pathJson -ceq '{"pythonImportPaths":["python312.zip","site-packages","../src"]}') 'Report paths must serialize as a plain JSON string array without profile/provider properties.'
$checks++
Assert-Verify ($serializationTimer.ElapsedMilliseconds -lt 5000) 'Serializing three report paths must not recurse into file-provider metadata.'
$checks++
[ordered]@{passed=$true;checks=$checks} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'report.json') -Encoding utf8
Write-Host "PASS: $checks verifier checks; report $testRoot/report.json"
