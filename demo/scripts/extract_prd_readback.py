#!/usr/bin/env python3

import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree


DOCX_PATH = Path("docs/多多直播_完整产品需求文档与关键技术验证方案_V1.0.docx")
OUTPUT_JSON = Path("demo/reports/prd-readback.json")
OUTPUT_MD = Path("demo/reports/prd-readback.md")
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

KEYWORDS = [
    "MVP",
    "直播",
    "多路",
    "音频",
    "ASR",
    "百炼",
    "匿名",
    "容器",
    "并发",
    "验收",
    "风险",
    "No-Go",
    "降级",
    "人工标注",
    "股票",
]


def text_from_paragraph(paragraph):
    texts = []
    for node in paragraph.iter(f"{WORD_NS}t"):
        if node.text:
            texts.append(node.text)
    return "".join(texts).strip()


def extract_docx_text(path):
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    lines = []
    for element in root.iter():
        if element.tag == f"{WORD_NS}p":
            text = text_from_paragraph(element)
            if text:
                lines.append(text)
    deduped = []
    for line in lines:
        if line not in deduped:
            deduped.append(line)
    return deduped


def is_heading(line):
    if re.match(r"^第[一二三四五六七八九十0-9]+[章节部分]", line):
        return True
    if re.match(r"^\d+(\.\d+)*[、. ]", line):
        return True
    if len(line) <= 30 and any(keyword in line for keyword in ["概述", "目标", "范围", "风险", "验收", "方案", "计划"]):
        return True
    return False


def keyword_hits(lines):
    hits = []
    for index, line in enumerate(lines, start=1):
        matched = [keyword for keyword in KEYWORDS if keyword.lower() in line.lower()]
        if matched:
            hits.append({
                "line": index,
                "keywords": matched,
                "text": line,
            })
    return hits


def build_report():
    lines = extract_docx_text(DOCX_PATH)
    headings = [
        {"line": index, "text": line}
        for index, line in enumerate(lines, start=1)
        if is_heading(line)
    ]
    hits = keyword_hits(lines)
    return {
        "source": str(DOCX_PATH),
        "source_exists": DOCX_PATH.exists(),
        "source_size_bytes": DOCX_PATH.stat().st_size if DOCX_PATH.exists() else None,
        "line_count": len(lines),
        "heading_candidates": headings[:80],
        "keyword_hits": hits[:160],
        "first_lines": [
            {"line": index, "text": line}
            for index, line in enumerate(lines[:40], start=1)
        ],
    }


def write_markdown(report):
    lines = [
        "# PRD Readback",
        "",
        "## Source",
        "",
        "| Item | Value |",
        "| --- | --- |",
        f"| source | `{report['source']}` |",
        f"| exists | {report['source_exists']} |",
        f"| size_bytes | {report['source_size_bytes']} |",
        f"| extracted_lines | {report['line_count']} |",
        "",
        "## First Lines",
        "",
        "| line | text |",
        "| ---: | --- |",
    ]
    for item in report["first_lines"]:
        lines.append(f"| {item['line']} | {item['text']} |")

    lines.extend([
        "",
        "## Heading Candidates",
        "",
        "| line | text |",
        "| ---: | --- |",
    ])
    for item in report["heading_candidates"]:
        lines.append(f"| {item['line']} | {item['text']} |")

    lines.extend([
        "",
        "## Keyword Hits",
        "",
        "| line | keywords | text |",
        "| ---: | --- | --- |",
    ])
    for item in report["keyword_hits"][:80]:
        text = item["text"].replace("|", " ")
        lines.append(f"| {item['line']} | {', '.join(item['keywords'])} | {text} |")

    lines.extend([
        "",
        "## Use In Validation",
        "",
        "- This readback proves the PRD file was parsed from `docs/` and key requirement text was extracted into `demo/`.",
        "- It does not replace the original PRD. The source `.docx` remains in `docs/`.",
        "- It is used by `objective-requirements-audit` as evidence for the read-required-files requirement.",
    ])
    OUTPUT_MD.write_text("\n".join(lines) + "\n")


def main():
    report = build_report()
    OUTPUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report)
    print(json.dumps({
        "output_json": str(OUTPUT_JSON),
        "output_md": str(OUTPUT_MD),
        "line_count": report["line_count"],
        "keyword_hits": len(report["keyword_hits"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
