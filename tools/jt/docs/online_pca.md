# online/pca
_source: https://open.jtjms-eg.com (chunk chunk-6040081a, extracted 2026-09-20)_

**Description:** 查询平台的收派件范围

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
| `type` | String(32) | N |  | 2、省；3市；4、区域(不传查全部可收派省市区，传3查询可收派市) |

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
| `prov` | String(32) | N |  | 省份名称 |
| `city` | String(32) | N |  | 城市名称 |
| `area` | String(32) | N |  | 区域名称 |

## requestCode
```json
Header：
    apiAccount=1627
    digest=U40e5sumorgd3YgZzU61Mw==
    timestamp=1565238848921

Body：
    bizContent= {
      "type":"4"
      }
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": {
        "area": "南山区",
        "city": "深圳市",
        "prov": "广东省"
    }
}
```

## Error codes
