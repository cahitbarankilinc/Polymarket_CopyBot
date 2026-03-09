import argparse
import json
from pprint import pprint
import sys

from py_clob_client.client import ClobClient
from py_clob_client.clob_types import OrderArgs, OrderType
from py_clob_client.order_builder.constants import BUY, SELL

MARKET_SLUG = "btc-updown-15m-1771281000"
OUTCOME = "UP"
ASSET_ID = (
    "14758085229624116374287908106326470782344944951281435922292073838136696315974"
)
SIDE = "BUY"  # "BUY" veya "SELL"
PRICE = 0.99  # 0.95 = 95¢
SIZE = 2  # kaç adet token
PRIVATE_KEY = ""

# ==============================

SIGNATURE_TYPE = 1
FUNDER_ADDRESS = ""

# ==============================

CLOB_API = "https://clob.polymarket.com"
CHAIN_ID = 137  # Polygon mainnet


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Polymarket limit order test tool")
    parser.add_argument("--market-slug", dest="market_slug", default=MARKET_SLUG)
    parser.add_argument("--outcome", default=OUTCOME)
    parser.add_argument("--asset-id", dest="asset_id", default=ASSET_ID)
    parser.add_argument("--side", default=SIDE)
    parser.add_argument("--price", type=float, default=PRICE)
    parser.add_argument("--size", type=float, default=SIZE)
    parser.add_argument("--private-key", dest="private_key", default=PRIVATE_KEY)
    parser.add_argument("--signature-type", dest="signature_type", type=int, default=SIGNATURE_TYPE)
    parser.add_argument("--funder", default=FUNDER_ADDRESS)
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON response")
    parser.add_argument(
        "--worker",
        action="store_true",
        help="Run as a long-lived JSONL worker (reads stdin, writes stdout)",
    )
    return parser.parse_args()


def execute_order(
    *,
    market_slug: str,
    outcome: str,
    asset_id: str,
    side: str,
    price: float,
    size: float,
    private_key: str,
    signature_type: int,
    funder: str,
    verbose: bool = True,
):
    if side.upper() not in ("BUY", "SELL"):
        raise ValueError('SIDE must be "BUY" or "SELL"')

    if not private_key.strip():
        raise ValueError("PRIVATE_KEY is required")

    if not funder.strip():
        raise ValueError("FUNDER_ADDRESS is required")

    side_const = BUY if side.upper() == "BUY" else SELL

    clob_kwargs = dict(
        host=CLOB_API,
        key=private_key,
        chain_id=CHAIN_ID,
        signature_type=signature_type,
        funder=funder.strip(),
    )

    auth_client = ClobClient(**clob_kwargs)

    if verbose:
        print("🔐 Deriving API key / setting creds ...")
    creds = auth_client.derive_api_key()
    auth_client.set_api_creds(creds)

    limit_order = OrderArgs(
        token_id=asset_id,
        price=float(price),
        size=float(size),
        side=side_const,
    )

    if verbose:
        print("✍️  Signing limit order ...")
    signed_order = auth_client.create_order(limit_order)

    if verbose:
        print("📤 Posting order (GTC) ...")
    resp = auth_client.post_order(signed_order, OrderType.GTC)

    return {
        "marketSlug": market_slug,
        "outcome": outcome,
        "assetId": asset_id,
        "side": side.upper(),
        "price": float(price),
        "size": float(size),
        "signatureType": int(signature_type),
        "funder": funder.strip(),
        "response": resp,
        "status": resp.get("status") if isinstance(resp, dict) else None,
    }


def main() -> int:
    args = parse_args()

    if args.worker:
        return run_worker(args)

    if not args.json:
        print("====================================")
        print(" POLYMARKET LIMIT ORDER TEST")
        print("====================================")
        print(f"Market:        {args.market_slug}")
        print(f"Outcome:       {args.outcome}")
        print(f"Asset ID:      {args.asset_id}")
        print(f"Side:          {args.side}")
        print(f"Limit Price:   {args.price}")
        print(f"Size:          {args.size}")
        print(f"SignatureType: {args.signature_type}")
        print(f"Funder:        {args.funder if args.funder else '(none)'}")
        print("====================================\n")

    try:
        payload = execute_order(
            market_slug=args.market_slug,
            outcome=args.outcome,
            asset_id=args.asset_id,
            side=args.side,
            price=args.price,
            size=args.size,
            private_key=args.private_key,
            signature_type=args.signature_type,
            funder=args.funder,
            verbose=not args.json,
        )
    except Exception as exc:
        if args.json:
            print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        else:
            print(f"\n❌ Error: {exc}")
        return 1

    if args.json:
        print(json.dumps({"success": True, **payload}, ensure_ascii=False))
    else:
        print("\n✅ Response:")
        pprint(payload["response"])

    return 0


def run_worker(args: argparse.Namespace) -> int:
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue

        req_id = None
        try:
            payload = json.loads(raw)
            req_id = payload.get("id")
            body = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload

            market_slug = str(body.get("marketSlug") or body.get("market_slug") or args.market_slug)
            outcome = str(body.get("outcome") or args.outcome)
            asset_id = str(body.get("assetId") or body.get("asset_id") or args.asset_id)
            side = str(body.get("side") or args.side)
            price = float(body.get("price") if body.get("price") is not None else args.price)
            size = float(body.get("size") if body.get("size") is not None else args.size)
            private_key = str(body.get("privateKey") or body.get("private_key") or args.private_key)
            signature_type = int(
                body.get("signatureType")
                if body.get("signatureType") is not None
                else body.get("signature_type")
                if body.get("signature_type") is not None
                else args.signature_type
            )
            funder = str(body.get("funder") or body.get("funderAddress") or body.get("funder_address") or args.funder)

            result = execute_order(
                market_slug=market_slug,
                outcome=outcome,
                asset_id=asset_id,
                side=side,
                price=price,
                size=size,
                private_key=private_key,
                signature_type=signature_type,
                funder=funder,
                verbose=False,
            )
            out = {"id": req_id, "success": True, **result}
        except Exception as exc:
            out = {"id": req_id, "success": False, "error": str(exc)}

        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
