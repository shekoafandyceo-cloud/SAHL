# ?
_source: https://open.jtjms-eg.com (chunk chunk-5c7dcd99, extracted 2026-09-20)_

**Description:** 通过国家三字码获取省市区

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
| `countryCode` | String(30) | Y |  | 国家三字码 中国CHN |

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
| `prov` | String(32) | Y |  | 省份名称 |
| `provCode` | String(32) | Y |  | 省份编码 |
| `city` | String(32) | Y |  | 城市 |
| `cityCode` | String(32) | Y |  | 城市编码 |
| `area` | String(32) | Y |  | 区域 |
| `areaCode` | String(32) | Y |  | 区域编码 |
| `postCode` | String(32) | Y |  | 邮编 |

## requestCode
```json
Header：
    apiAccount=1627
    digest=U40e5sumorgd3YgZzU61Mw==
    timestamp=1565238848921

Body：
    bizContent={
            "countryCode": "CHN"
            }
```

## responseCode
```json
{"code": "10","msg": "success","data": [{"parentId": 3,"prov": "安徽省","provCode": "3","city": "安庆","cityCode": "36","area": "迎江区","postCode": "12342","areaCode": "398"}]}
```

## Error codes
- `145003090` — 三字码信息不全
