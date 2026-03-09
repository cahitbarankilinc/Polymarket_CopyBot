import argparse
import json
from pprint import pprint
import sys

from py_clob_client.client import ClobClient
from py_clob_client.clob_types import MarketOrderArgs, OrderArgs, OrderType
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
ORDER_KIND = "limit"
ORDER_TYPE = "GTC"
ACTION = "place"
ORDER_ID = ""

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
    parser.add_argument("--order-kind", dest="order_kind", default=ORDER_KIND)
    parser.add_argument("--order-type", dest="order_type", default=ORDER_TYPE)
    parser.add_argument("--order-id", dest="order_id", default=ORDER_ID)
    parser.add_argument("--action", default=ACTION, choices=("place", "get", "cancel"))
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON response")
    parser.add_argument(
        "--worker",
        action="store_true",
        help="Run as a long-lived JSONL worker (reads stdin, writes stdout)",
    )
    return parser.parse_args()


def get_response_status(response):
    if not isinstance(response, dict):
        return None

    for key in ("status", "state", "orderStatus"):
        value = response.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    if response.get("canceled") is True or response.get("cancelled") is True:
        return "cancelled"

    return None


def normalize_order_type(value: str):
    normalized = (value or "").strip().upper() or ORDER_TYPE
    if normalized not in {"GTC", "FAK", "FOK", "GTD"}:
        raise ValueError("ORDER_TYPE must be one of GTC, FAK, FOK, GTD")
    return getattr(OrderType, normalized)


def normalize_order_kind(value: str):
    normalized = (value or "").strip().lower() or ORDER_KIND
    if normalized not in {"limit", "market-like"}:
        raise ValueError('ORDER_KIND must be "limit" or "market-like"')
    return normalized


def build_client(*, private_key: str, signature_type: int, funder: str, verbose: bool):
    if not private_key.strip():
        raise ValueError("PRIVATE_KEY is required")
    if not funder.strip():
        raise ValueError("FUNDER_ADDRESS is required")

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
    return auth_client


def execute_place_order(
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
    order_kind: str,
    order_type: str,
    verbose: bool = True,
):
    if side.upper() not in ("BUY", "SELL"):
        raise ValueError('SIDE must be "BUY" or "SELL"')

    order_kind_value = normalize_order_kind(order_kind)
    order_type_value = normalize_order_type(order_type)
    side_const = BUY if side.upper() == "BUY" else SELL

    auth_client = build_client(
        private_key=private_key,
        signature_type=signature_type,
        funder=funder,
        verbose=verbose,
    )

    if order_kind_value == "limit":
        order_args = OrderArgs(
            token_id=asset_id,
            price=float(price),
            size=float(size),
            side=side_const,
        )
        if verbose:
            print("✍️  Signing limit order ...")
        signed_order = auth_client.create_order(order_args)
    else:
        order_args = MarketOrderArgs(
            token_id=asset_id,
            amount=float(size),
            side=side_const,
            price=float(price) if float(price) > 0 else 0,
            order_type=order_type_value,
        )
        if verbose:
            print("✍️  Signing market-like order ...")
        signed_order = auth_client.create_market_order(order_args)

    if verbose:
        print(f"📤 Posting order ({order_type_value}) ...")
    resp = auth_client.post_order(signed_order, order_type_value)

    return {
        "action": "place",
        "marketSlug": market_slug,
        "outcome": outcome,
        "assetId": asset_id,
        "side": side.upper(),
        "price": float(price),
        "size": float(size),
        "orderKind": order_kind_value,
        "orderType": order_type_value,
        "signatureType": int(signature_type),
        "funder": funder.strip(),
        "response": resp,
        "orderId": resp.get("orderID") if isinstance(resp, dict) else None,
        "status": get_response_status(resp),
    }


def execute_get_order(
    *,
    order_id: str,
    private_key: str,
    signature_type: int,
    funder: str,
    verbose: bool = True,
):
    clean_order_id = (order_id or "").strip()
    if not clean_order_id:
        raise ValueError("ORDER_ID is required for get action")

    auth_client = build_client(
        private_key=private_key,
        signature_type=signature_type,
        funder=funder,
        verbose=verbose,
    )
    if verbose:
        print(f"📥 Fetching order {clean_order_id} ...")
    resp = auth_client.get_order(clean_order_id)
    return {
        "action": "get",
        "orderId": clean_order_id,
        "response": resp,
        "status": get_response_status(resp),
    }


def execute_cancel_order(
    *,
    order_id: str,
    private_key: str,
    signature_type: int,
    funder: str,
    verbose: bool = True,
):
    clean_order_id = (order_id or "").strip()
    if not clean_order_id:
        raise ValueError("ORDER_ID is required for cancel action")

    auth_client = build_client(
        private_key=private_key,
        signature_type=signature_type,
        funder=funder,
        verbose=verbose,
    )
    if verbose:
        print(f"🛑 Cancelling order {clean_order_id} ...")
    resp = auth_client.cancel(clean_order_id)
    status = get_response_status(resp) or "cancelled"
    return {
        "action": "cancel",
        "orderId": clean_order_id,
        "response": resp,
        "status": status,
    }


def main() -> int:
    args = parse_args()

    if args.worker:
        return run_worker(args)

    if not args.json:
        print("====================================")
        print(" POLYMARKET ORDER TEST")
        print("====================================")
        print(f"Action:        {args.action}")
        print(f"Market:        {args.market_slug}")
        print(f"Outcome:       {args.outcome}")
        print(f"Asset ID:      {args.asset_id}")
        print(f"Side:          {args.side}")
        print(f"Price:         {args.price}")
        print(f"Size:          {args.size}")
        print(f"OrderKind:     {args.order_kind}")
        print(f"OrderType:     {args.order_type}")
        print(f"OrderID:       {args.order_id if args.order_id else '(none)'}")
        print(f"SignatureType: {args.signature_type}")
        print(f"Funder:        {args.funder if args.funder else '(none)'}")
        print("====================================\n")

    try:
        if args.action == "get":
            payload = execute_get_order(
                order_id=args.order_id,
                private_key=args.private_key,
                signature_type=args.signature_type,
                funder=args.funder,
                verbose=not args.json,
            )
        elif args.action == "cancel":
            payload = execute_cancel_order(
                order_id=args.order_id,
                private_key=args.private_key,
                signature_type=args.signature_type,
                funder=args.funder,
                verbose=not args.json,
            )
        else:
            payload = execute_place_order(
                market_slug=args.market_slug,
                outcome=args.outcome,
                asset_id=args.asset_id,
                side=args.side,
                price=args.price,
                size=args.size,
                private_key=args.private_key,
                signature_type=args.signature_type,
                funder=args.funder,
                order_kind=args.order_kind,
                order_type=args.order_type,
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
            order_kind = str(body.get("orderKind") or body.get("order_kind") or args.order_kind)
            order_type = str(body.get("orderType") or body.get("order_type") or args.order_type)
            action = str(body.get("action") or args.action)
            order_id = str(body.get("orderId") or body.get("order_id") or args.order_id)
            private_key = str(body.get("privateKey") or body.get("private_key") or args.private_key)
            signature_type = int(
                body.get("signatureType")
                if body.get("signatureType") is not None
                else body.get("signature_type")
                if body.get("signature_type") is not None
                else args.signature_type
            )
            funder = str(body.get("funder") or body.get("funderAddress") or body.get("funder_address") or args.funder)

            if action == "get":
                result = execute_get_order(
                    order_id=order_id,
                    private_key=private_key,
                    signature_type=signature_type,
                    funder=funder,
                    verbose=False,
                )
            elif action == "cancel":
                result = execute_cancel_order(
                    order_id=order_id,
                    private_key=private_key,
                    signature_type=signature_type,
                    funder=funder,
                    verbose=False,
                )
            else:
                result = execute_place_order(
                    market_slug=market_slug,
                    outcome=outcome,
                    asset_id=asset_id,
                    side=side,
                    price=price,
                    size=size,
                    private_key=private_key,
                    signature_type=signature_type,
                    funder=funder,
                    order_kind=order_kind,
                    order_type=order_type,
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
