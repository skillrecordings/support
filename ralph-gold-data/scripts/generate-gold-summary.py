#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "gold.duckdb"
REPORTS_DIR = ROOT / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def export_query(query: str, out_path: Path) -> list[dict]:
    if out_path.exists():
        out_path.unlink()
    sql = f"COPY ({query}) TO '{out_path}' (FORMAT JSON);"
    subprocess.run(["duckdb", str(DB_PATH), "-c", sql], check=True, cwd=ROOT)
    rows: list[dict] = []
    if out_path.exists():
        with out_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
    return rows


def main() -> None:
    tmp_dir = Path("/tmp")
    totals_rows = export_query(
        "SELECT product, COUNT(*) AS total FROM conversations GROUP BY product ORDER BY total DESC, product",
        tmp_dir / "gold_totals.json",
    )
    request_rows = export_query(
        (
            "SELECT c.product, cl.request_type, COUNT(*) AS count "
            "FROM classifications cl "
            "JOIN conversations c ON c.id = cl.conversation_id "
            "GROUP BY c.product, cl.request_type "
            "ORDER BY c.product, count DESC"
        ),
        tmp_dir / "gold_request_matrix.json",
    )
    tier_rows = export_query(
        "SELECT product, CASE WHEN quality_score >= 5 THEN 'gold' WHEN quality_score >= 3 THEN 'silver' ELSE 'noise' END AS tier, COUNT(*) AS count FROM conversations GROUP BY product, tier ORDER BY product, tier",
        tmp_dir / "gold_tiers.json",
    )
    top_types_rows = export_query(
        (
            "SELECT cl.request_type, COUNT(*) AS count "
            "FROM classifications cl "
            "GROUP BY cl.request_type "
            "ORDER BY count DESC, cl.request_type "
            "LIMIT 10"
        ),
        tmp_dir / "gold_top_types.json",
    )
    gold_ratio_rows = export_query(
        "SELECT product, SUM(CASE WHEN quality_score >= 5 THEN 1 ELSE 0 END) AS gold, COUNT(*) AS total, ROUND(SUM(CASE WHEN quality_score >= 5 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*), 4) AS gold_ratio FROM conversations GROUP BY product ORDER BY gold_ratio DESC, total DESC, product",
        tmp_dir / "gold_ratio.json",
    )

    totals_by_product = [
        {"product": row["product"], "total": int(row["total"])} for row in totals_rows
    ]

    # Build request type matrix
    request_types = []
    overall_counts: dict[str, int] = {}
    matrix: dict[str, dict[str, int]] = {}
    for row in request_rows:
        product = row["product"]
        request_type = row["request_type"]
        count = int(row["count"])
        matrix.setdefault(product, {})[request_type] = count
        overall_counts[request_type] = overall_counts.get(request_type, 0) + count
    request_types = [
        k for k, _ in sorted(overall_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    # Tier breakdown with totals and gold ratio
    tiers_by_product: dict[str, dict[str, int]] = {}
    for row in tier_rows:
        product = row["product"]
        tier = row["tier"]
        count = int(row["count"])
        tiers_by_product.setdefault(product, {})[tier] = count

    tier_breakdown = []
    for product in sorted({row["product"] for row in tier_rows} | {row["product"] for row in totals_rows}):
        gold = tiers_by_product.get(product, {}).get("gold", 0)
        silver = tiers_by_product.get(product, {}).get("silver", 0)
        noise = tiers_by_product.get(product, {}).get("noise", 0)
        total = gold + silver + noise
        ratio = (gold / total) if total else 0.0
        tier_breakdown.append(
            {
                "product": product,
                "gold": gold,
                "silver": silver,
                "noise": noise,
                "total": total,
                "gold_ratio": round(ratio, 4),
            }
        )

    top_request_types = [
        {"request_type": row["request_type"], "count": int(row["count"])}
        for row in top_types_rows
    ]

    gold_ratio_by_product = [
        {
            "product": row["product"],
            "gold": int(row["gold"]),
            "total": int(row["total"]),
            "gold_ratio": float(row["gold_ratio"]),
        }
        for row in gold_ratio_rows
    ]

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    summary = {
        "generated_at": generated_at,
        "totals_by_product": totals_by_product,
        "request_type_distribution": {
            "request_types": request_types,
            "matrix": [
                {
                    "product": product,
                    "counts": [matrix.get(product, {}).get(rt, 0) for rt in request_types],
                }
                for product in sorted(matrix.keys())
            ],
        },
        "tier_breakdown_by_product": tier_breakdown,
        "top_request_types": top_request_types,
        "gold_ratio_by_product": gold_ratio_by_product,
    }

    json_path = REPORTS_DIR / "gold-summary.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, sort_keys=True)
        f.write("\n")

    md_lines = []
    md_lines.append("# Gold Summary Report")
    md_lines.append("")
    md_lines.append(f"Generated: {generated_at}")
    md_lines.append("")

    md_lines.append("## Totals by Product")
    md_lines.append("| Product | Total conversations |")
    md_lines.append("| --- | --- |")
    for row in totals_by_product:
        md_lines.append(f"| {row['product']} | {row['total']} |")
    md_lines.append("")

    md_lines.append("## Request Type Distribution by Product")
    header = "| Product | " + " | ".join(request_types) + " |"
    separator = "| --- | " + " | ".join(["---"] * len(request_types)) + " |"
    md_lines.append(header)
    md_lines.append(separator)
    for product in sorted(matrix.keys()):
        counts = [str(matrix.get(product, {}).get(rt, 0)) for rt in request_types]
        md_lines.append("| " + product + " | " + " | ".join(counts) + " |")
    md_lines.append("")

    md_lines.append("## Gold / Silver / Noise by Product")
    md_lines.append("| Product | Gold | Silver | Noise | Total | Gold ratio |")
    md_lines.append("| --- | --- | --- | --- | --- | --- |")
    for row in tier_breakdown:
        ratio_pct = f"{row['gold_ratio'] * 100:.1f}%"
        md_lines.append(
            f"| {row['product']} | {row['gold']} | {row['silver']} | {row['noise']} | {row['total']} | {ratio_pct} |"
        )
    md_lines.append("")

    md_lines.append("## Top 10 Request Types Overall")
    md_lines.append("| Rank | Request type | Count |")
    md_lines.append("| --- | --- | --- |")
    for idx, row in enumerate(top_request_types, start=1):
        md_lines.append(f"| {idx} | {row['request_type']} | {row['count']} |")
    md_lines.append("")

    md_lines.append("## Products with Highest Gold Ratio")
    md_lines.append("| Rank | Product | Gold | Total | Gold ratio |")
    md_lines.append("| --- | --- | --- | --- | --- |")
    for idx, row in enumerate(gold_ratio_by_product, start=1):
        ratio_pct = f"{row['gold_ratio'] * 100:.1f}%"
        md_lines.append(
            f"| {idx} | {row['product']} | {row['gold']} | {row['total']} | {ratio_pct} |"
        )
    md_lines.append("")

    md_path = REPORTS_DIR / "gold-summary.md"
    with md_path.open("w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))


if __name__ == "__main__":
    main()
