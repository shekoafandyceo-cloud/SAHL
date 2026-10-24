# (callback) other/settlementReturn — J&T بتنده URL بتاعنا
_source: https://open.jtjms-eg.com (chunk chunk-72f4a9f0, extracted 2026-09-20)_

**Description:** 接入方提供回传URL，极兔将通过接口下单的订单进行审核账单后，对订单进行回传账单信息

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
| `waybillNo` | String(30) | Y |  | Waybill number |
| `totalFreight` | String(30) | Y |  | 总运费 |
| `packageChargeWeight` | String(30) | Y |  | 计费重量 |
| `insuredFee` | String(30) | N |  | 保价费 |
| `freight` | String(30) | Y |  | 运费 |
| `customerCode` | String(30) | Y | J0086024138 | 客户编号 |

## Response

### Response parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `code` | String | Y |  | Return code, see appendix |
| `msg` | String | Y |  | describe |
| `data` | String | Y |  | Business data |

## requestCode
```json
Header：
apiAccount=1362
digest=U40e5sumorgd3YgZzU61Mw==
timestamp=1565238848921

Body：
bizContent={
  "customerCode": "J0086024138",
  "freight": 0,
  "insuredFee": 36,
  "packageChargeWeight": 3,
  "totalFreight": 36,
  "waybillNo": "UT0000273527404"
}

```

## Error codes
