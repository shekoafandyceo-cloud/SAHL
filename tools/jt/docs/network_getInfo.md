# network/getInfo
_source: https://open.jtjms-eg.com (chunk chunk-6322f77e, extracted 2026-09-20)_

**Description:** 根据地址查询平台的网点信息和三段码信息

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
| `Body` | Object | Y |  | Business parameters |
| `province` | String(32) | Y |  | 省份名称 |
| `city` | String(32) | Y |  | 城市名称 |
| `area` | String(32) | Y |  | 区县名称 |
| `details` | String(32) | Y |  | 详细地址 |

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
| `networkName` | String(32) | N |  | 网点名称 |
| `mobile` | String(32) | N |  | 网点联系电话 |
| `networkAddress` | String(32) | N |  | 网点地址 |
| `full` | String(32) | N |  | 三段码信息 |

## requestCode
```json
Header：
    apiAccount=1627
    digest=U40e5sumorgd3YgZzU61Mw==
    timestamp=1565238848921

Body：
    bizContent={
      "area":"九龙坡区",
      "city":"重庆",
      "details":"金科绿韵康城2栋11-4",
      "province":"重庆"
      }
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": {
        "networkName": "信丰网点",
        "mobile": "15889652565",
        "networkAddress": "站前大道信丰车站派出所",
        "full": "101 100-82 000"
    }
}
```

## Error codes
