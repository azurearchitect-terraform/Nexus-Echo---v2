//! Dual-stream audio capture with voice activity detection.
//!
//! Two streams run concurrently: the microphone (the user) and system loopback
//! (everyone else on the call). Keeping them separate is what makes speaker
//! attribution reliable — no clustering algorithm is as accurate as simply knowing
//! which device the audio arrived on. Diarization then only has to separate the
//! remote speakers from each other.

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_input: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Microphone,
    System,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Utterance {
    pub source: Source,
    pub start_ms: u64,
    pub end_ms: u64,
    /// 16 kHz mono PCM, base64 WAV — handed to whichever STT engine is configured.
    pub wav_base64: String,
    pub peak_energy: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VadEvent {
    pub source: Source,
    pub speaking: bool,
    pub energy: f32,
}

/// Energy-gated VAD with hangover. The hangover window is what stops a natural
/// pause mid-sentence from being cut into two utterances — the single most common
/// cause of garbled transcripts in naive implementations.
pub struct Vad {
    threshold: f32,
    silence_frames_needed: usize,
    silence_run: usize,
    speaking: bool,
    noise_floor: f32,
}

impl Vad {
    pub fn new(threshold: f32, silence_ms: u32, frame_ms: u32) -> Self {
        Self {
            threshold,
            silence_frames_needed: (silence_ms / frame_ms.max(1)).max(1) as usize,
            silence_run: 0,
            speaking: false,
            noise_floor: 0.005,
        }
    }

    /// Returns Some(true) when speech starts, Some(false) when an utterance closes.
    pub fn push(&mut self, frame: &[f32]) -> (Option<bool>, f32) {
        let energy = rms(frame);

        // Adaptive floor: track ambient noise slowly while silent so a noisy cafe
        // does not read as constant speech.
        if !self.speaking {
            self.noise_floor = self.noise_floor * 0.98 + energy * 0.02;
        }
        let gate = (self.noise_floor * 2.5).max(self.threshold);

        if energy > gate {
            self.silence_run = 0;
            if !self.speaking {
                self.speaking = true;
                return (Some(true), energy);
            }
        } else if self.speaking {
            self.silence_run += 1;
            if self.silence_run >= self.silence_frames_needed {
                self.speaking = false;
                self.silence_run = 0;
                return (Some(false), energy);
            }
        }
        (None, energy)
    }

    pub fn is_speaking(&self) -> bool {
        self.speaking
    }
}

fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt()
}

pub fn list_devices() -> Result<Vec<AudioDevice>> {
    let host = cpal::default_host();
    let default_in = host.default_input_device().and_then(|d| d.name().ok());
    let mut devices = Vec::new();

    for device in host.input_devices()? {
        let name = device.name().unwrap_or_else(|_| "Unknown".into());
        devices.push(AudioDevice {
            id: name.clone(),
            is_default: Some(&name) == default_in.as_ref(),
            name,
            is_input: true,
        });
    }
    // Loopback devices surface as outputs on Windows (WASAPI) and as virtual
    // inputs (BlackHole / PulseAudio monitor) elsewhere.
    for device in host.output_devices()? {
        let name = device.name().unwrap_or_else(|_| "Unknown".into());
        devices.push(AudioDevice { id: name.clone(), name, is_input: false, is_default: false });
    }
    Ok(devices)
}

#[allow(dead_code)]
pub struct SendStream(pub cpal::Stream);
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

pub struct CaptureSession {
    running: Arc<AtomicBool>,
    started_at: std::time::Instant,
    #[allow(dead_code)]
    streams: Mutex<Vec<SendStream>>,
}

impl CaptureSession {
    pub fn elapsed_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.streams.lock().clear();
    }
}

/// Starts one capture stream. Called once per source; both share the same session clock.
pub fn start_stream(
    app: AppHandle,
    device_name: Option<String>,
    source: Source,
    vad_threshold: f32,
    vad_silence_ms: u32,
    running: Arc<AtomicBool>,
    epoch: std::time::Instant,
) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let device = match (&device_name, source) {
        (Some(name), _) => host
            .input_devices()?
            .chain(host.output_devices()?)
            .find(|d| d.name().map(|n| &n == name).unwrap_or(false))
            .ok_or_else(|| anyhow!("audio device '{name}' not found"))?,
        (None, Source::Microphone) => host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default microphone"))?,
        (None, Source::System) => host
            .default_output_device()
            .ok_or_else(|| anyhow!("no system audio device — install a loopback driver"))?,
    };

    let config = device
        .default_input_config()
        .or_else(|_| device.default_output_config())?;
    let in_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let sample_format = config.sample_format();
    let frame_ms = 30u32;
    let frame_len = (TARGET_SAMPLE_RATE * frame_ms / 1000) as usize;

    let vad = Arc::new(Mutex::new(Vad::new(vad_threshold, vad_silence_ms, frame_ms)));
    let pending = Arc::new(Mutex::new(Vec::<f32>::new()));
    let carry = Arc::new(Mutex::new(Vec::<f32>::new()));
    let utterance_start = Arc::new(Mutex::new(0u64));

    let app_cb = app.clone();
    let err_app = app.clone();

    let process_samples = move |data: &[f32]| {
        if !running.load(Ordering::SeqCst) {
            return;
        }

        // Downmix to mono, then decimate to 16 kHz.
        let mono: Vec<f32> = data
            .chunks(channels)
            .map(|c| c.iter().sum::<f32>() / channels as f32)
            .collect();
        let resampled = decimate(&mono, in_rate, TARGET_SAMPLE_RATE);

        let mut buf = carry.lock();
        buf.extend_from_slice(&resampled);

        while buf.len() >= frame_len {
            let frame: Vec<f32> = buf.drain(..frame_len).collect();
            let (transition, energy) = vad.lock().push(&frame);

            match transition {
                Some(true) => {
                    *utterance_start.lock() = epoch.elapsed().as_millis() as u64;
                    pending.lock().clear();
                    let _ = app_cb.emit("nexus://vad", VadEvent { source, speaking: true, energy });
                }
                Some(false) => {
                    let samples = std::mem::take(&mut *pending.lock());
                    let _ = app_cb.emit("nexus://vad", VadEvent { source, speaking: false, energy });
                    // Ignore short notification sounds, chimes, and pings (require at least 600ms of audio)
                    if samples.len() >= (TARGET_SAMPLE_RATE as usize * 6 / 10) {
                        let peak = samples.iter().fold(0f32, |a, s| a.max(s.abs()));
                        let utterance = Utterance {
                            source,
                            start_ms: *utterance_start.lock(),
                            end_ms: epoch.elapsed().as_millis() as u64,
                            wav_base64: encode_wav(&samples),
                            peak_energy: peak,
                        };
                        let _ = app_cb.emit("nexus://utterance", utterance);
                    }
                }
                None => {}
            }

            if vad.lock().is_speaking() {
                pending.lock().extend_from_slice(&frame);
            }
        }
    };

    let stream_config = config.config();
    let err_cb = move |err: cpal::StreamError| {
        tracing::error!("audio stream error: {err}");
        let _ = err_app.emit("nexus://audio-error", err.to_string());
    };

    let process = Arc::new(process_samples);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let p = process.clone();
            device.build_input_stream(&stream_config, move |d: &[f32], _| p(d), err_cb, None)?
        }
        cpal::SampleFormat::I16 => {
            let p = process.clone();
            device.build_input_stream(
                &stream_config,
                move |d: &[i16], _| {
                    let f: Vec<f32> = d.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                    p(&f);
                },
                err_cb,
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let p = process.clone();
            device.build_input_stream(
                &stream_config,
                move |d: &[u16], _| {
                    let f: Vec<f32> = d.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).collect();
                    p(&f);
                },
                err_cb,
                None,
            )?
        }
        format => return Err(anyhow!("unsupported sample format '{format}'")),
    };

    stream.play()?;
    Ok(stream)
}

/// Straight decimation with a light box filter to knock down aliasing. Adequate for
/// speech at 16 kHz; swap in `rubato` if you need studio-grade resampling.
fn decimate(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to {
        return input.to_vec();
    }
    let ratio = from as f32 / to as f32;
    let out_len = (input.len() as f32 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let start = (i as f32 * ratio) as usize;
        let end = (((i + 1) as f32) * ratio) as usize;
        let end = end.min(input.len()).max(start + 1);
        let slice = &input[start..end.min(input.len())];
        if slice.is_empty() {
            break;
        }
        out.push(slice.iter().sum::<f32>() / slice.len() as f32);
    }
    out
}

fn encode_wav(samples: &[f32]) -> String {
    use base64::Engine;
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut writer = match hound::WavWriter::new(&mut cursor, spec) {
            Ok(w) => w,
            Err(_) => return String::new(),
        };
        for &s in samples {
            let _ = writer.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16);
        }
        let _ = writer.finalize();
    }
    base64::engine::general_purpose::STANDARD.encode(cursor.into_inner())
}

pub fn new_session() -> (Arc<AtomicBool>, std::time::Instant, CaptureSession) {
    let running = Arc::new(AtomicBool::new(true));
    let epoch = std::time::Instant::now();
    let session = CaptureSession {
        running: running.clone(),
        started_at: epoch,
        streams: Mutex::new(Vec::new()),
    };
    (running, epoch, session)
}

impl CaptureSession {
    pub fn attach(&self, stream: cpal::Stream) {
        self.streams.lock().push(SendStream(stream));
    }
}
