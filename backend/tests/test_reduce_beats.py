
from app.services.pmv_generator import reduce_beats

def test_reduce_beats_thins():
    times = [0.0, 0.1, 0.2, 0.5, 1.0]
    out = reduce_beats(times, min_dist=0.3, length=1.0)
    assert out[0] == 0.0
    assert out[-1] == 1.0
