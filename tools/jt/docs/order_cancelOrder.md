# order/cancelOrder
_source: https://open.jtjms-eg.com (chunk chunk-0a8adf58, extracted 2026-09-20)_

**Description:** OrderDescription_3

## Request

### Headers

| name | type | req | example | describe |
|---|---|---|---|---|
| `apiAccount` | Number | Y |  | The api account ID of the access party on the platform |
| `digest` | String | Y |  | Signature string |
| `timestamp` | Number | Y |  | Timestamp, milliseconds |

### Request parameter

| name | type | req | example | describe |
|---|---|---|---|---|
| `bizContent` | String | Y | Business parameters | The string type in json format in the business parameter module |

### Business parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `customerCode` | String(30) | N | J0086024138 | Customer code (required when the order type is passed 2) |
| `digest` | String(50) | N | Clear text password: KO6w29g2 | sign |
| `orderType` | String(30) | Y |  | Order type 1 (individual customers), 2 (contract customers) |
| `10000000001299` | String(50) | Y |  | Customer order number (pass the order number of the customer’s own system) |
| `reason` | String(50) | Y |  | Reason for Cancellation |

## Response

### Response parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `code` | String | Y |  | Return code, see appendix |
| `msg` | String | Y |  | describe |
| `data` | Object | Y |  | Business data |

### Data type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `billCode` | String | Y |  | Waybill number |
| `10000000001299` | String | Y |  | customer order no |

## requestCode
```json
Header：
    apiAccount=292508153084379141
    digest=RQzkX32UzmX9D0fkc35vbQ==
    timestamp=1646984344443

Body：
    bizContent={
      'txlogisticId': 'EGYUAT73577596805', 
      'orderType': 1, 
      'reason': 'jiushixiangquxiaoyouruhe', 
      'customerCode': 'J0086024138', 
      'digest': 'wapT8IYOjNeViOL5eZupEg=='
    }
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": {"txlogisticId":"EGYUAT66966506193","billCode":"UEG000000195735"}
}
```

## Error codes
- `145003031` — Business parameter signature verification failed
- `145003082` — Customer order number cannot be empty or too long
- `145003089` — Cancellation reason cannot be empty
