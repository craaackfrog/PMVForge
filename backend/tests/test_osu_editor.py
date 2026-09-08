
from app.services.osu_editor import parse_osu_text, rewrite_osu_hitobjects

SAMPLE = """osu file format v14

[General]
AudioFilename: song.mp3

[Metadata]
Title:Test
Artist:Art
Creator:Me
Version:Hard

[TimingPoints]
0,500,4,2,0,70,1,0

[HitObjects]
256,192,1000,1,0,0:0:0:0:
256,192,2000,1,0,0:0:0:0:
"""

def test_parse_beats():
    data = parse_osu_text(SAMPLE)
    assert data["title"] == "Test"
    assert data["artist"] == "Art"
    assert data["beats"] == [1.0, 2.0]
    assert data["audio_filename"] == "song.mp3"

def test_rewrite():
    out = rewrite_osu_hitobjects(SAMPLE, [0.5, 1.5])
    assert "[HitObjects]" in out
