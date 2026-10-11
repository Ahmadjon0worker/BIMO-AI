& (Join-Path $PSScriptRoot 'runtime\python.exe') (Join-Path $PSScriptRoot 'src\service_main.py') --tools @args
exit $LASTEXITCODE
