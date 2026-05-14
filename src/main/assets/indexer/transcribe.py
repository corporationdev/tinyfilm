#!/usr/bin/env python3
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Transcribe media with faster-whisper.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise RuntimeError(
            "Python package faster-whisper is not installed. Install it with: python3 -m pip install faster-whisper"
        ) from exc

    model = WhisperModel(args.model, device="auto", compute_type="auto")
    segments, info = model.transcribe(
        args.input,
        language=args.language,
        vad_filter=True,
        word_timestamps=False,
    )

    result = {
        "language": info.language,
        "languageProbability": info.language_probability,
        "segments": [
            {
                "startMs": round(segment.start * 1000),
                "endMs": round(segment.end * 1000),
                "text": segment.text.strip(),
            }
            for segment in segments
            if segment.text.strip()
        ],
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
