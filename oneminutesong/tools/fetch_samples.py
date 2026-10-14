#!/usr/bin/env python3
"""Download, trim and compress the instrument samples into ../samples.

Needs ffmpeg. Run from anywhere:  python3 oneminutesong/tools/fetch_samples.py

Sources (see ../CREDITS.md):
  Piano   Salamander Grand Piano by Alexander Holm, CC BY 3.0 (via the Tone.js audio repo)
  Others  FluidR3 GM soundfont by Frank Wen, CC BY 3.0 (rendered to mp3 by gleitz/midi-js-soundfonts)
  Drums   Versilian Community Sample Library (VCSL), CC0
"""
import os
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'samples')

SALAMANDER = 'https://raw.githubusercontent.com/Tonejs/audio/master/salamander/{note}.mp3'
FLUID = 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/{inst}-mp3/{note}.mp3'
VCSL = 'https://raw.githubusercontent.com/sgossner/VCSL/master/{path}'

# Pitched instruments are sampled every minor third (C, Eb, Gb, A); the player
# repitches the nearest sample by at most a semitone and a half.
STEPS = ['C', 'Eb', 'Gb', 'A']
SALAMANDER_NAMES = {'C': 'C', 'Eb': 'Ds', 'Gb': 'Fs', 'A': 'A'}

# id: (source, instrument, low octave, high octave, seconds kept)
PITCHED = {
    'piano':     ('salamander', None, 2, 6, 4.0),
    'epiano':    ('fluid', 'electric_piano_1', 2, 6, 3.5),
    'pad':       ('fluid', 'pad_2_warm', 2, 6, 6.0),
    'organ':     ('fluid', 'drawbar_organ', 2, 6, 4.0),
    'strings':   ('fluid', 'string_ensemble_1', 2, 6, 6.0),
    'guitar':    ('fluid', 'acoustic_guitar_nylon', 2, 6, 3.0),
    'vibes':     ('fluid', 'vibraphone', 3, 7, 3.0),
    'lead':      ('fluid', 'lead_2_sawtooth', 3, 7, 3.0),
    'bass':      ('fluid', 'electric_bass_finger', 1, 4, 3.0),
    'synthbass': ('fluid', 'synth_bass_1', 1, 4, 2.0),
}

# id: (VCSL path, seconds kept)
DRUMS = {
    'kick':      ('Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v5_rr1_Sum.wav', 0.8),
    'kick-soft': ('Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v3_rr1_Sum.wav', 0.8),
    'snare':     ('Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_HitSN_v7_rr1_Mid.wav', 0.7),
    'snare-ghost': ('Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_HitSN_v3_rr1_Mid.wav', 0.5),
    'rim':       ('Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_stick_v1_rr1_Mid.wav', 0.3),
    'hat':       ('Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v3_rr1_Mid.wav', 0.35),
    'hat-soft':  ('Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v1_rr1_Mid.wav', 0.3),
    'open':      ('Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitLoose_rr1_Mid.wav', 1.2),
    'clap':      ('Idiophones/Struck Idiophones/Claps/Clap_rr1.wav', 0.6),
    'ride':      ('Idiophones/Struck Idiophones/Suspended Cymbal 1/susCymb1_hit_stick_mp1.wav', 2.5),
    'shaker':    ('Idiophones/Struck Idiophones/Shaker, Small/Mid_ShakerHighFaster_Down_rr1.wav', 0.4),
}


def fetch(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'one-minute-song-sample-fetch'})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, 'wb') as f:
        f.write(r.read())


def peak_db(src):
    """Loudest sample in dBFS, from ffmpeg's volumedetect."""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', 'volumedetect', '-f', 'null', '-'],
                       capture_output=True, text=True)
    for line in r.stderr.splitlines():
        if 'max_volume' in line:
            return float(line.split('max_volume:')[1].split('dB')[0])
    return 0.0


def encode(src, dest, seconds, mono=False, bitrate='96k', normalize=False):
    """Trim leading silence, cut to `seconds` with a short fade out, optionally peak-normalize to -1 dBFS."""
    fade = min(0.4, seconds / 3)
    filters = [
        'silenceremove=start_periods=1:start_threshold=-50dB',
        f'atrim=0:{seconds}',
        f'afade=t=out:st={seconds - fade}:d={fade}',
    ]
    if normalize:
        filters.append(f'volume={-1 - peak_db(src):.2f}dB')
    args = ['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af', ','.join(filters)]
    if mono:
        args += ['-ac', '1']
    args += ['-ar', '44100', '-b:a', bitrate, dest]
    subprocess.run(args, check=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp()
    total = 0
    for inst, (source, gm, lo, hi, secs) in PITCHED.items():
        folder = os.path.join(OUT, inst)
        os.makedirs(folder, exist_ok=True)
        for octave in range(lo, hi + 1):
            for step in STEPS:
                if octave == hi and step != 'C':
                    continue
                name = f'{step}{octave}'
                if source == 'salamander':
                    url = SALAMANDER.format(note=f'{SALAMANDER_NAMES[step]}{octave}')
                else:
                    url = FLUID.format(inst=gm, note=name)
                raw = os.path.join(tmp, f'{inst}-{name}.mp3')
                fetch(url, raw)
                dest = os.path.join(folder, f'{name}.mp3')
                encode(raw, dest, secs, mono=(inst in ('bass', 'synthbass')))
                total += os.path.getsize(dest)
        print(f'{inst}: done')
    folder = os.path.join(OUT, 'drums')
    os.makedirs(folder, exist_ok=True)
    for name, (path, secs) in DRUMS.items():
        raw = os.path.join(tmp, f'{name}.wav')
        fetch(VCSL.format(path=urllib.parse.quote(path)), raw)
        dest = os.path.join(folder, f'{name}.mp3')
        encode(raw, dest, secs, mono=True, bitrate='128k', normalize=True)
        total += os.path.getsize(dest)
    print(f'drums: done\ntotal {total / 1e6:.2f} MB')


if __name__ == '__main__':
    sys.exit(main())
