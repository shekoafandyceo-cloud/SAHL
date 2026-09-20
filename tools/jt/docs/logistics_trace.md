# logistics/trace
_source: https://open.jtjms-eg.com (chunk chunk-5d07f50e, extracted 2026-09-20)_

**Description:** trackDescription_1

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
| `billCodes` | String(500) | Y |  | Waybill number. Multiple waybill numbers are separated by English commas. Currently, it supports querying up to 30 waybills at one time. |

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
| `details` | Array | Y |  | Waybill track details |
| `numberOfDispatch` | Array | N |  | Delivery days |

### details type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `scanTime` | String | Y |  | Scan time |
| `desc` | String | Y |  | Trajectory description |
| `scanType` | String | Y |  | scanType |
| `scanTypeCode` | String | Y | 10 | scanTypeCode |
| `scanNetworkName` | String | Y |  | Scan site name |
| `scanNetworkId` | String | Y |  | Scan site ID |
| `staffName` | String | Y |  | Salesman's name |
| `staffContact` | String | Y |  | Salesman contact information |
| `scanNetworkContact` | String | Y |  | Scan the contact information of outlets |
| `scanNetworkProvince` | String | Y |  | Scan the provinces of outlets |
| `scanNetworkCity` | String | Y |  | Scan the city |
| `scanNetworkArea` | String | Y |  | Scanning outlet district/county |
| `nextStopName` | String | Y |  | Last stop (arrival) or next stop name (sent) |
| `nextNetworkProvinceName` | String | Y |  | Next stop province (provided when sending scan type |
| `nextNetworkCityName` | String | Y |  | Next stop city (provided when sending scan type) |
| `nextNetworkAreaName` | String | Y |  | Next stop district/county (provided when sending scan type) |
| `sigPicUrl` | String | N |  | Sign in picture (provided when signing in scanning type) |
| `electronicSignaturePicUrl` | String | N |  | Electronic signature picture (provided when signing for scanning type) |
| `probleDescription` | String | N |  | Problem part description (provided when the problem part is scanned) |
| `collectPicUrl` | String | N |  | Pick up and take photos (provided for express pick up type) |
| `collectElectronicSignaturePicUrl` | String | N |  | Pick up electronic signature picture (provided for express pick up type) |
| `problemPicUrl` | String | N |  | Picture of the problematic part (provided when the problematic part is scanned) |
| `otp` | String | N |  | OTP verification code (provided when signing for the scan type) |

## requestCode
```json
Header：
    apiAccount=292508153084379141
    digest=+4VwUm11evdiYZ4KgsXLrA==
    timestamp=1646984719909

Body：
    bizContent= {'billCodes': 'UEG000000190252'}
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": [{"billCode":"UEG000000190252","details":[{"scanTime":"2022-03-09 12:26:25","desc":"【Zagazig】【TEST1-A2网点】J&T courier TEST网点CZA2(15912345678) completed the delivery.Received by【个人签收】， If there is any problem or complaint, please dial branch‘s phone number：7897892234","scanType":"Signing scan","scanNetworkTypeName":"网点","scanNetworkName":"TEST1-A2网点","scanNetworkId":225,"scanNetworkProvince":"الشرقية","scanNetworkCity":"Zagazig","scanNetworkArea":"حي الزهور","problemReason":"快件签收"},{"scanTime":"2022-03-09 12:26:09","desc":"【Zagazig】【TEST1-A2网点】J&T courier TEST网点CZA2(15912345678)is delivering the shipment. If there is any problem or complaint, please dial branch‘s phone number：7897892234","scanType":"Delivery scan","scanNetworkTypeName":"网点","scanNetworkName":"TEST1-A2网点","scanNetworkId":225,"scanNetworkProvince":"الشرقية","scanNetworkCity":"Zagazig","scanNetworkArea":"حي الزهور","problemReason":"派件扫描"},{"scanTime":"2022-03-09 12:24:36","desc":"【Zagazig】Shipment arrived at【TEST1-A2网点】","scanType":"Station arrival","scanNetworkTypeName":"网点","scanNetworkName":"TEST1-A2网点","scanNetworkId":225,"scanNetworkProvince":"الشرقية","scanNetworkCity":"Zagazig","scanNetworkArea":"حي الزهور","nextStopName":"Al Mokattam BR","problemReason":"到件扫描"},{"scanTime":"2022-03-09 12:23:55","desc":"【Zagazig】Shipment departed from【TEST1-A2网点】to【Al Mokattam BR】","scanType":"Sending scan","scanNetworkTypeName":"网点","scanNetworkName":"TEST1-A2网点","scanNetworkId":225,"scanNetworkProvince":"الشرقية","scanNetworkCity":"Zagazig","scanNetworkArea":"حي الزهور","nextStopName":"Al Mokattam BR","problemReason":"发件扫描"},{"scanTime":"2022-03-09 12:23:09","desc":"【Zagazig】【TEST1-A2网点】J&T courier TEST网点CZA2(15912345678)picked up the shipment. If there is any problem or complaint, please dial branch‘s phone number：7897892234","scanType":"Pickup scan","scanNetworkTypeName":"网点","scanNetworkName":"TEST1-A2网点","scanNetworkId":225,"scanNetworkProvince":"الشرقية","scanNetworkCity":"Zagazig","scanNetworkArea":"حي الزهور","problemReason":"快件揽收"}]}]
}
```

## Error codes
- `145003100` — Illegal waybill number
- `145003502` — The quantity of the waybill number exceeds 30
