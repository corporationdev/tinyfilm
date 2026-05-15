#!/usr/bin/env python3
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Transcribe media with faster-whisper.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default=None)
    parser.add_argument("--word-timestamps", action="store_true")
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
        word_timestamps=args.word_timestamps,
    )

    result = {
        "language": info.language,
        "languageProbability": info.language_probability,
        "segments": [],
    }

    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue

        entry = {
                "startMs": round(segment.start * 1000),
                "endMs": round(segment.end * 1000),
                "text": text,
        }
        words = getattr(segment, "words", None)
        if args.word_timestamps and words:
            entry["words"] = [
                {
                    "startMs": round(word.start * 1000),
                    "endMs": round(word.end * 1000),
                    "text": word.word.strip(),
                }
                for word in words
                if word.word.strip()
            ]

        result["segments"].append(entry)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
