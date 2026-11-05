# (callback) logistics/statusFeedback — J&T بتنده URL بتاعنا
_source: https://open.jtjms-eg.com (chunk chunk-f59c55f6, extracted 2026-09-20)_

**Description:** trackDescription_3

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
| `billCode` | String(30) | Y |  | Waybill number |
| `10000000001299` | String(60) | N |  | customer order no |
| `details` | Array | Y |  | Courier track details |

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
| `sigPicUrl` | String | N |  | Sign in picture (provided when signing in scanning type) |
| `electronicSignaturePicUrl` | String | N |  | Electronic signature picture (provided when signing for scanning type) |
| `probleDescription` | String | N |  | Problem part description (provided when the problem part is scanned) |
| `collectPicUrl` | String | N |  | Pick up and take photos (provided for express pick up type) |
| `collectElectronicSignaturePicUrl` | String | N |  | Pick up electronic signature picture (provided for express pick up type) |
| `problemPicUrl` | String | N |  | Picture of the problematic part (provided when the problematic part is scanned) |
| `otp` | String | N |  | OTP verification code (provided when signing for the scan type) |

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
{
\t"billCode": "1146708484138602002",
\t"details": [{
            "billCode":"UT0000264445622",
            "desc":"【南京雨花台春江新城网点】您的极兔小哥 test1040 已取件。如需联系网点，请拨打 15850664590 特殊时期，您的牵挂，让极兔小哥为您速递！ᕱ ᕱ",
            "scanNetworkArea":"江宁区",
            "scanNetworkCity":"南京市",
            "scanNetworkContact":"15850664590",
            "scanNetworkId":1772,
            "scanNetworkName":"南京雨花台春江新城网点",
            "scanNetworkProvince":"江苏省",
            "scanNetworkTypeName":"南京雨花台春江新城网点",
            "scanTime":"2020-07-16 09:26:15",
            "scanType":"快件揽收"
        },
\t\t{
            "billCode":"UT0000264445622",
            "desc":"亲，有您的快递！【南京玄武网点】的极兔小哥 test1042 (13123456789) 正带着包裹来见您，如需联系该网点，请拨打 17314954950 今天的极兔小哥，体温正常，口罩戴好，消毒到位，即将为您打call",
            "scanNetworkArea":"玄武区",
            "scanNetworkCity":"南京市",
            "scanNetworkContact":"17314954950",
            "scanNetworkId":33,
            "scanNetworkName":"南京玄武网点",
            "scanNetworkProvince":"江苏省",
            "scanNetworkTypeName":"南京玄武网点",
            "scanTime":"2020-07-16 09:26:31",
            "scanType":"出仓扫描"
        }\t],
\t"txlogisticId": "8792773877787"
}
}
```

## Error codes
