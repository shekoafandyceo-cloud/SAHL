# spmComCost/getComCost
_source: https://open.jtjms-eg.com (chunk chunk-31712259, extracted 2026-09-20)_

**Description:** 通过收寄件地址及物品信息预估运费

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
| `customerCode` | String(30) | Y | J0086024138 | Customer code (provided by contacting the shipping outlet) |
| `digest` | String(50) | Y | Clear text password: KO6w29g2 | 签名，Base64(Md5(客户编号+密文+privateKey))，其中密文：MD5(明文密码+jadada236t2) 后大写 |
| `sender` | Object | Y |  | Shipment information object |
| `receiver` | Object | Y |  | Receiving information object |
| `length` | int(6) | N |  | 长，cm编号 |
| `width` | int(6) | N |  | 宽，cm |
| `height` | int(6) | N |  | 高，cm |
| `weight` | String(12) | Y | 0.02 | 重量（正数），单位kg，范围0.01-30，为空默认0.02 |

### sender type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `prov` | String(32) | Y |  | Sending province |
| `city` | String(32) | Y |  | Sending city |
| `area` | String(32) | Y |  | 寄件城区域 |
| `town` | String(32) | N |  | 寄件乡镇 |
| `street` | String(32) | N |  | Sending street |
| `address` | String(150) | Y |  | 寄件详细地址（省+市+区县+详细地址） |

### Receiver type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `prov` | String(32) | Y |  | Receiving province |
| `city` | String(32) | Y |  | Receiving city |
| `area` | String(32) | Y |  | 收件城区域 |
| `town` | String(32) | N |  | 收件乡镇 |
| `street` | String(32) | N |  | Receiving street |
| `address` | String(150) | Y |  | 收件详细地址（省+市+区县+详细地址） |

## Response

### Response parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `code` | String | Y |  | Return code, see appendix |
| `msg` | String | Y |  | describe |
| `data` | Object | Y |  | Business data |
| `totalPrice` | String | Y |  | 运费总价（单位：元），保留两位小数 |

## requestCode
```json
Header：
    apiAccount=1627
    digest=U40e5sumorgd3YgZzU61Mw==
    timestamp=1565238848921

Body：
    bizContent= {"receiver": {"area": "鼓楼区", "address": "中检大厦测试订单", "city": "南京市", "town": "", "street": "", "prov": "江苏"}, "sender": {"area": "鼓楼区", "address": "中检大厦测试订单", "city": "南京市", "town": "", "street": "", "prov": "江苏"}, "length": 10, "width": 10, "height": 10, "weight": 3.2, "digest": "JfuEJ9U4nZvh6Sx+7sxzkQ==", "customerCode": "J0086023910"}
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": {
      "totalPrice":4.5
    }
}
```

## Error codes
- `145003031` — Business parameter signature verification failed
- `145003083` — Incomplete sender information
- `145003084` — Incomplete recipient information
- `145003092` — The weight information is not legal
- `145003080` — 客户未找到
- `145003065` — 省市区地址不合法
