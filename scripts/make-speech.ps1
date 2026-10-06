# Gera um WAV de fala em português (voz do Windows) com pausas, uma frase repetida
# e uma gagueira propositais. Usado pelo teste e2e da Fase 2.
# Uso: powershell -File scripts/make-speech.ps1 <saida.wav>
param([string]$Out = "fala-teste.wav")
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Maria Desktop')
$s.Rate = 0
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $fmt)
$ssml = @'
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR">
Olá pessoal, tudo bem?
<break time="1800ms"/>
Hoje eu quero, hoje eu quero falar sobre felicidade.
<break time="900ms"/>
Eu, eu acho que a felicidade é uma escolha que a gente faz todos os dias.
<break time="2200ms"/>
Muito obrigado por assistir e até a próxima.
<break time="600ms"/>
</speak>
'@
$s.SpeakSsml($ssml)
$s.Dispose()
Write-Output "ok $Out"
