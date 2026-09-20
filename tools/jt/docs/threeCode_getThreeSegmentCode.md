# threeCode/getThreeSegmentCode
_source: https://open.jtjms-eg.com (chunk chunk-38f43a34, extracted 2026-09-20)_

**Description:** The api account ID of the access party on the platform

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
| `sender` | Object | N |  | Shipment information object |
| `receiver` | Object | Y |  | Receiving information object |

### sender type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `countryCode` | String(20) | Y |  | ThreeCharacterSending |
| `prov` | String(32) | Y |  | Sending province |
| `city` | String(32) | Y |  | Sending city |
| `area` | String(32) | Y |  | Shipping area |
| `street` | String(32) | Y |  | Sending street |
| `longitude` | BigDecimal | N |  | longitude |
| `latitude` | BigDecimal | N |  | latitude |

### Receiver type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `countryCode` | String(20) | Y |  | ThreeCharacterRecipient |
| `prov` | String(32) | Y |  | Receiving province |
| `city` | String(32) | Y |  | Receiving city |
| `area` | String(32) | Y |  | Receiving area |
| `street` | String(32) | Y |  | Receiving street |
| `longitude` | BigDecimal | N |  | longitude |
| `latitude` | BigDecimal | N |  | latitude |

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
| `lastCenterName` | String | N |  | Collection land |
| `sortingCode` | String | Y |  | Three-segment code (get the three-segment code first to return to the three-segment code, if there is no three-segment code, return to the big pen) |

## requestCode
```json
Header：
    apiAccount=292508153084379141
    Content-Type=application/x-www-form-urlencoded
    digest=djEINdkT7aLeivrvhf91SQ==
    timestamp=1648536570679

Body：
    bizContent={"sender": {"area": "المقطم", "street": "Cairo", "city": "الجيزة", "countryCode": "EGY", "prov": "الجيزة", "longitude": 30.1, "latitude": 20.1}, "receiver": {"area": "المقطم", "street": "محافظه البحيره - مركز وادي النطرون - المنطقه الصناعيه - بجوار الصعيدي للكوتش ", "city": "الجيزة", "countryCode": "EGY", "prov": "الجيزة", "longitude": 30.1, "latitude": 20.1}}
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": {
      "lastCenterName":"Dubai DC",
      "sortingCode":"DC04-CN011-"
    }
}
```

## Error codes
- `145003083` — Incomplete information of origin
- `145003084` — Incomplete information of receiving place
