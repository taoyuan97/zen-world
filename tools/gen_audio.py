#!/usr/bin/env python3
"""Zen World M4 音频资产批量生成驱动（B1 决策：云端 TTS + 生成式环境音）。

用法：
  python3 tools/gen_audio.py voice <hillId>   # 生成某山全部 cue 语音（5min/10min 两档）
  python3 tools/gen_audio.py ambience         # 生成 10 山环境音（缺失的）
  python3 tools/gen_audio.py sfx              # 生成交互音效（缺失的）
  python3 tools/gen_audio.py status           # 汇总统计

特性：已存在且非空的文件自动跳过（断点续跑）；失败重试一次，仍失败记入 manifest missing。
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = (
    "C:/Users/18520/AppData/Roaming/kimi-desktop/daimon-share/daimon/runtime/"
    "kimi-code/home/plugins/managed/audio_generation/scripts/audio_generation_tool.py"
)
VOICE_ID = "05Cdh2gw2NMzDvykn1nm"  # 沉稳中年男声（B1 决策）
VOICE_DIR = ROOT / "public" / "audio" / "voice"
AMBIENCE_DIR = ROOT / "public" / "audio" / "ambience"
SFX_DIR = ROOT / "public" / "audio" / "sfx"
MANIFEST = VOICE_DIR / "manifest.json"

# 每山环境音英文描述（GDD §3.2 主题定），20~22s 循环素材（D2）
AMBIENCE = {
    "bamboo": ("Gentle wind rustling through bamboo leaves, soft bamboo stalks creaking, "
               "calm quiet forest ambience, no birds, seamless loop", 21),
    "snowpeak": ("Cold soft mountain wind blowing over snowy peaks, quiet high altitude ambience, "
                 "gentle wind gusts, seamless loop", 21),
    "lakeside": ("Calm lake water gently lapping on a shore, soft water ripples, "
                 "peaceful lakeside ambience, seamless loop", 21),
    "starfield": ("Quiet night plateau ambience, soft night breeze, sparse distant crickets, "
                  "vast calm night atmosphere, seamless loop", 21),
    "desert": ("Soft desert wind over sand dunes, gentle drifting sand, warm calm desert evening "
               "ambience, seamless loop", 21),
    "sakura": ("Gentle small stream flowing, soft spring breeze, very sparse distant birds, "
               "peaceful hillside ambience, seamless loop", 21),
    "mistvalley": ("Deep misty valley ambience, low soft wind hum, occasional distant water droplet "
                   "echoes, calm foggy atmosphere, seamless loop", 21),
    "grassland": ("Wind blowing in waves through tall grass, soft rustling grassland, "
                  "open field ambience, seamless loop", 21),
    "hotspring": ("Hot spring water bubbling softly, gentle steam and slow water drips, "
                  "warm calm ambience, seamless loop", 21),
    "temple": ("Soft wind through pine trees, a distant deep temple bell resonating once in a while, "
               "calm mountain temple ambience, seamless loop", 22),
}

SFX = {
    "lit": ("Soft warm singing bowl strike with gentle shimmering reverb, meditation chime", 2.5),
    "complete": ("Gentle warm achievement chime, soft harp glissando, calm reward sound", 2.5),
    "ui-confirm": ("Soft wooden tap, gentle UI confirmation click", 0.8),
    "ui-open": ("Soft airy whoosh, gentle UI panel opening sound", 1.0),
}


def run_tool(args: list[str]) -> bool:
    """调用插件脚本，失败重试一次。返回是否成功。"""
    for attempt in (1, 2):
        proc = subprocess.run(
            [sys.executable, TOOL, *args],
            capture_output=True, text=True, encoding="utf-8",
        )
        if proc.returncode == 0:
            return True
        print(f"  [retry {attempt}] {proc.stderr.strip()[-300:]}", flush=True)
        time.sleep(3)
    return False


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {"voiceId": VOICE_ID, "entries": [], "missing": []}


def save_manifest(m: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")


def gen_voice(hill_id: str) -> None:
    manifest = load_manifest()
    done_keys = {(e["hillId"], e["minutes"], e["index"]) for e in manifest["entries"] if e.get("ok")}
    missing_keys = {(e["hillId"], e["minutes"], e["index"]) for e in manifest["missing"]}

    for minutes in (5, 10):
        script_path = ROOT / "src" / "data" / "meditations" / f"{hill_id}.{minutes}min.json"
        script = json.loads(script_path.read_text(encoding="utf-8"))
        out_dir = VOICE_DIR / hill_id
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, cue in enumerate(script["cues"]):
            key = (hill_id, minutes, i)
            out = out_dir / f"{minutes}m{i:02d}.mp3"
            if out.exists() and out.stat().st_size > 1000 and key in done_keys:
                continue
            if key in missing_keys:
                continue  # 已记录失败，重跑需先清理 manifest missing
            print(f"[voice] {hill_id} {minutes}m cue{i}: {cue['text'][:20]}…", flush=True)
            ok = run_tool(["speech", "--voice-id", VOICE_ID,
                           "--text", cue["text"], "--output", str(out)])
            entry = {"hillId": hill_id, "minutes": minutes, "index": i,
                     "t": cue["t"], "text": cue["text"],
                     "file": f"audio/voice/{hill_id}/{minutes}m{i:02d}.mp3", "ok": ok}
            if ok:
                manifest["entries"].append(entry)
                done_keys.add(key)
            else:
                # 移除旧 missing 记录后重写
                manifest["missing"] = [e for e in manifest["missing"]
                                       if (e["hillId"], e["minutes"], e["index"]) != key]
                manifest["missing"].append(entry)
                if out.exists():
                    out.unlink()
            save_manifest(manifest)
            time.sleep(1)  # 尊重限流


def gen_ambience() -> None:
    AMBIENCE_DIR.mkdir(parents=True, exist_ok=True)
    for hill_id, (desc, dur) in AMBIENCE.items():
        out = AMBIENCE_DIR / f"{hill_id}.mp3"
        if out.exists() and out.stat().st_size > 1000:
            print(f"[ambience] {hill_id} 已存在，跳过", flush=True)
            continue
        print(f"[ambience] {hill_id}", flush=True)
        ok = run_tool(["sound-effects", "--description", desc,
                       "--duration", str(dur), "--output", str(out)])
        if not ok:
            print(f"  !! {hill_id} 环境音生成失败", flush=True)
            if out.exists():
                out.unlink()
        time.sleep(1)


def gen_sfx() -> None:
    SFX_DIR.mkdir(parents=True, exist_ok=True)
    for name, (desc, dur) in SFX.items():
        out = SFX_DIR / f"{name}.mp3"
        if out.exists() and out.stat().st_size > 500:
            print(f"[sfx] {name} 已存在，跳过", flush=True)
            continue
        print(f"[sfx] {name}", flush=True)
        ok = run_tool(["sound-effects", "--description", desc,
                       "--duration", str(dur), "--output", str(out)])
        if not ok:
            print(f"  !! {name} 音效生成失败", flush=True)
            if out.exists():
                out.unlink()
        time.sleep(1)


def status() -> None:
    m = load_manifest()
    ok = [e for e in m["entries"] if e.get("ok")]
    print(f"voice ok={len(ok)} missing={len(m['missing'])}")
    for e in m["missing"]:
        print(f"  MISSING {e['hillId']} {e['minutes']}m cue{e['index']}")
    for hill_id in AMBIENCE:
        p = AMBIENCE_DIR / f"{hill_id}.mp3"
        print(f"ambience {hill_id}: {'OK' if p.exists() else 'MISSING'}")
    for name in SFX:
        p = SFX_DIR / f"{name}.mp3"
        print(f"sfx {name}: {'OK' if p.exists() else 'MISSING'}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "voice":
        gen_voice(sys.argv[2])
    elif cmd == "ambience":
        gen_ambience()
    elif cmd == "sfx":
        gen_sfx()
    else:
        status()
