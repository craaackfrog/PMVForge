export const DEFAULTS = {
  clip_dist: 0.4,
  aspect: '16:9',
  quality: 'hd',
  zoom_to_fill: false,
  clip_order: 'random',
  fps: 30,
  bitrate: '',
  threads: 4,
  cuda: false,
  debug: false,
  num_vids: 0,
  recurse: false,
  effects: {
    enabled: false,
    soft_pulse: true,
    soft_pulse_strength: 0.12,
    flash: false,
    flash_strength: 0.55,
    flash_max_per_sec: 8,
    zoom_punch: true,
    zoom_punch_amount: 1.06,
    rgb_split: false,
    rgb_split_px: 4,
    pink_glow: false,
    pink_glow_strength: 0.35,
    pink_glow_saturation: 1.15,
  },
}

export const QUALITY_LABELS = { hd: 'HD', fhd: 'Full HD', '4k': '4K' }
export const RES_HINT = {
  '16:9': { hd: '1280×720', fhd: '1920×1080', '4k': '3840×2160' },
  '9:16': { hd: '720×1280', fhd: '1080×1920', '4k': '2160×3840' },
}
