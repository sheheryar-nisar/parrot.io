param(
  [string[]]$Langs = @('eng', 'spa', 'fra', 'deu', 'ita', 'por', 'chi_sim', 'jpn', 'kor', 'ara', 'urd', 'hin', 'osd')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tesseractDir = Join-Path $root 'src/lib/tesseract'

New-Item -ItemType Directory -Force -Path $tesseractDir | Out-Null

Copy-Item (Join-Path $root 'node_modules/tesseract.js/dist/tesseract.min.js') $tesseractDir -Force
Copy-Item (Join-Path $root 'node_modules/tesseract.js/dist/worker.min.js') $tesseractDir -Force

$coreFiles = @(
  'tesseract-core.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-simd-lstm.wasm.js'
)

foreach ($coreFile in $coreFiles) {
  Copy-Item (Join-Path $root "node_modules/tesseract.js-core/$coreFile") $tesseractDir -Force
}

foreach ($lang in $Langs) {
  $url = "https://tessdata.projectnaptha.com/4.0.0/$lang.traineddata.gz"
  $out = Join-Path $tesseractDir "$lang.traineddata.gz"
  Write-Host "Downloading $lang..."
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

Write-Host 'Tesseract assets ready.'
