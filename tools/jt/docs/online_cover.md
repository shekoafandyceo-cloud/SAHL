# online/cover
_source: https://open.jtjms-eg.com (chunk chunk-e8b891b6, extracted 2026-09-20)_

**Description:** 查询地址是否超出平台的收派件范围

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
| `prov` | String(32) | Y |  | 省份名称 |
| `city` | String(32) | Y |  | 城市名称 |
| `area` | String(32) | Y |  | 区域名称 |

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
| `success` | Boolean | Y |  | 返回true 、false  ；true表示支持收派；false表示暂不支持收派 |

## requestCode
```json
Header：
    apiAccount=1627
    digest=U40e5sumorgd3YgZzU61Mw==
    timestamp=1565238848921

Body：
    bizContent= {
"prov": "广东省",
"city": "深圳市",
"area": "南山区"
}
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": [
        {           
           "success": "true"
        }
  ]
}

```

## Error codes
