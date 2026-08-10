/**
 * Kesilmiş ürün fotoğrafından çalışma anında bir GLB (3D model) üretir.
 *
 * Neden: cihaz yönelim sensörü sadece DÖNMEYİ takip eder. Kullanıcı odada
 * yürüdüğünde ürün onunla birlikte kayar. Ürünün gerçekten yerinde kalması ve
 * etrafında dolaşılabilmesi için konum takibi (6DoF) gerekir; bunu tarayıcıda
 * yalnızca WebXR / ARCore verir ve o da bir 3D model ister.
 *
 * Burada üretilen model, ürünün gerçek en/yükseklik ölçüsünde tek bir dikey
 * düzlemdir; dokusu şeffaf ürün kesimidir. Yani "karton kesim": konumu,
 * ölçeği ve zemine oturması gerçektir, hacmi değildir. Gerçek hacim için
 * ürün başına asıl 3D model gerekir — paketin 2. aşaması.
 */

const HIZALA = (n) => (n + 3) & ~3

function pngBaytlari(canvas) {
  return new Promise((coz) => canvas.toBlob((b) => b.arrayBuffer().then(coz), 'image/png'))
}

/**
 * @param {HTMLCanvasElement} kesim şeffaf ürün kesimi
 * @param {number} enM  gerçek genişlik (metre)
 * @param {number} boyM gerçek yükseklik (metre)
 * @returns {Promise<string>} blob: URL (model-viewer'a verilebilir)
 */
export async function duzlemGlbUret(kesim, enM, boyM) {
  const png = new Uint8Array(await pngBaytlari(kesim))

  const yariEn = enM / 2
  // Tabanı y=0'da: model zemine oturur, AR'da yere yerleştirildiğinde doğru durur
  const konumlar = new Float32Array([
    -yariEn, 0, 0,
    yariEn, 0, 0,
    yariEn, boyM, 0,
    -yariEn, boyM, 0,
  ])
  const uvler = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0])
  const indisler = new Uint16Array([0, 1, 2, 0, 2, 3])

  const parcalar = [konumlar, uvler, indisler, png]
  const uzunluklar = parcalar.map((p) => p.byteLength)
  const kaymalar = []
  let toplam = 0
  for (const u of uzunluklar) {
    kaymalar.push(toplam)
    toplam = HIZALA(toplam + u)
  }

  const ikili = new Uint8Array(toplam)
  parcalar.forEach((p, i) => {
    ikili.set(new Uint8Array(p.buffer || p, p.byteOffset || 0, p.byteLength), kaymalar[i])
  })

  const json = {
    asset: { version: '2.0', generator: 'Enza AR demo' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'urun' }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
        alphaMode: 'BLEND',
        doubleSided: true,
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    buffers: [{ byteLength: toplam }],
    bufferViews: [
      { buffer: 0, byteOffset: kaymalar[0], byteLength: uzunluklar[0], target: 34962 },
      { buffer: 0, byteOffset: kaymalar[1], byteLength: uzunluklar[1], target: 34962 },
      { buffer: 0, byteOffset: kaymalar[2], byteLength: uzunluklar[2], target: 34963 },
      { buffer: 0, byteOffset: kaymalar[3], byteLength: uzunluklar[3] },
    ],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: 4, type: 'VEC3',
        min: [-yariEn, 0, 0], max: [yariEn, boyM, 0],
      },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
  }

  const jsonBaytlari = new TextEncoder().encode(JSON.stringify(json))
  const jsonDolgu = HIZALA(jsonBaytlari.length) - jsonBaytlari.length

  const toplamUzunluk = 12 + 8 + jsonBaytlari.length + jsonDolgu + 8 + ikili.length
  const tampon = new ArrayBuffer(toplamUzunluk)
  const gorunum = new DataView(tampon)
  const baytlar = new Uint8Array(tampon)
  let o = 0

  gorunum.setUint32(o, 0x46546c67, true); o += 4 // "glTF"
  gorunum.setUint32(o, 2, true); o += 4
  gorunum.setUint32(o, toplamUzunluk, true); o += 4

  gorunum.setUint32(o, jsonBaytlari.length + jsonDolgu, true); o += 4
  gorunum.setUint32(o, 0x4e4f534a, true); o += 4 // "JSON"
  baytlar.set(jsonBaytlari, o); o += jsonBaytlari.length
  for (let i = 0; i < jsonDolgu; i++) baytlar[o++] = 0x20 // boşluk dolgusu

  gorunum.setUint32(o, ikili.length, true); o += 4
  gorunum.setUint32(o, 0x004e4942, true); o += 4 // "BIN"
  baytlar.set(ikili, o)

  return URL.createObjectURL(new Blob([tampon], { type: 'model/gltf-binary' }))
}

/** Cihaz gerçek AR (konum takipli) destekliyor mu? */
export async function gercekArDestekliMi() {
  try {
    return !!(await navigator.xr?.isSessionSupported('immersive-ar'))
  } catch {
    return false
  }
}
