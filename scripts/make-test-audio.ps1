<#
.SYNOPSIS
  用 Windows 自带语音合成一段"两人会议"测试录音，放进工作区，供 P4 实机测试用。

.DESCRIPTION
  不依赖任何网络服务。说话人 A 用中文 Huihui，说话人 B 用英文 Zira，
  两个音色差异明显，可以顺带看极速版的说话人分离能否分开它们。
  输出 16 kHz / 16 bit / 单声道 WAV，与 asr-contract 的 wav 格式一致。

  合成音频不能替代真实会议录音：它能验通"凭证 → 请求 → 逐字稿 → 运行记录"这条链路，
  但转写准确率、分离效果的结论仍须来自真实录音（见计划 P4.5）。

.PARAMETER OutDir
  输出目录，默认读 .env 的 SHOREKEEPER_WORKSPACE_DIR，读不到则 D:\SQLlite\workspace。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/make-test-audio.ps1
#>
param(
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $OutDir) {
  $envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*SHOREKEEPER_WORKSPACE_DIR\s*=' } | Select-Object -First 1
    if ($line) { $OutDir = ($line -split '=', 2)[1].Trim().Trim('"') }
  }
  if (-not $OutDir) { $OutDir = 'D:\SQLlite\workspace' }
}
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$zh = $voices | Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
$en = $voices | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
if (-not $zh) { throw '没有安装中文语音（zh-CN）。设置 → 时间和语言 → 语音 里添加中文语音后重试。' }

# 一段带议题、结论、待办、截止日期的短会议：P4.4 纪要技能将来也能拿它试。
$dialogue = @(
  @{ voice = $zh; text = '好，我们开始。今天要定两件事：一是季度报告的提交时间，二是客户培训的安排。' },
  @{ voice = $en; text = 'Sure. For the quarterly report, I can finish the draft by next Wednesday.' },
  @{ voice = $zh; text = '那就定下周三之前交初稿，由你负责。我周五之前给你反馈。' },
  @{ voice = $en; text = 'Got it. For the customer training, we still need a venue and a date.' },
  @{ voice = $zh; text = '场地我来订，这周内确认。日期先定在下个月十五号，如果客户有意见再调。' },
  @{ voice = $en; text = 'Okay. I will send the invitation to the customer after the venue is confirmed.' },
  @{ voice = $zh; text = '好，那今天就这两条。会后我把待办发到群里，散会。' }
)

$outPath = Join-Path $OutDir '测试会议.wav'
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($outPath, $format)

foreach ($turn in $dialogue) {
  $v = $turn.voice
  if (-not $v) { $v = $zh }
  $synth.SelectVoice($v.Name)
  $synth.Rate = 0
  $builder = New-Object System.Speech.Synthesis.PromptBuilder
  $builder.StartVoice($v.Name)
  $builder.AppendText($turn.text)
  $builder.AppendBreak([System.TimeSpan]::FromMilliseconds(900))
  $builder.EndVoice()
  $synth.Speak($builder)
}

$synth.SetOutputToNull()
$synth.Dispose()

$size = (Get-Item $outPath).Length
$seconds = [math]::Round(($size - 44) / (16000 * 2), 1)
Write-Host ("已生成: {0}" -f $outPath)
Write-Host ("大小: {0:N0} 字节，约 {1} 秒，16 kHz 单声道" -f $size, $seconds)
Write-Host ("说话人 A: {0}；说话人 B: {1}" -f $zh.Name, $(if ($en) { $en.Name } else { '（无英文语音，全部由 A 朗读）' }))
