/**
 * Beyaz fonlu stüdyo fotoğrafından şeffaf ürün kesimi üretir.
 *
 * Enza kataloğundaki ürün kareleri ~#f5f5f5 fon üzerine çekilmiş. Kenarlardan
 * başlayan bir taşma-doldurma (flood fill) ile SADECE kenara bağlı fon
 * pikselleri silinir; ürünün içindeki açık renkler (bej vazo, krem kumaş)
 * korunur.
 *
 * Katalog fotoğrafları AR için hazır değil, iki tuzak var:
 *
 *   1. Ödül rozetleri ("German Design Award" vb.) köşelere basılmış. Kesime
 *      dahil olurlarsa hem sahnede görünürler hem de ürünün en/boy kutusunu
 *      şişirirler. Çözüm: kesimin EN BÜYÜK bağlantılı parçası alınır.
 *
 *   2. Bazı kareler kolaj ya da kenardan kırpılmış. Bunlar ürünün gerçek
 *      oranını vermez. Çözüm: ürün başına birkaç aday karenin kalitesi
 *      ölçülür, kataloğdaki gerçek ölçüye en yakın oranı veren kare seçilir.
 */

const onbellek = new Map()
const secimOnbellegi = new Map()

function renkFarki(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * Fon eşiği sabit değil, fonun kendi gürültüsünden türetilir.
 *
 * Sabit ve yüksek bir eşik (30 gibi) koyu ürünlerde iyi çalışır ama BEYAZ
 * ürünleri yer: krem bir sandalye fondan sadece birkaç ton uzaktır ve kesim
 * ürünün içine doğru akar. Stüdyo fonu çok temiz olduğu için eşiği kenar
 * halkasının standart sapmasına bağlamak iki durumu da kurtarıyor.
 */
function esikler(sapma) {
  return { kati: Math.min(26, Math.max(11, sapma * 3.2)) }
}

async function gorselYukle(src) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  return img
}

/** Görseli bir tuvale çizip piksel verisini döndürür (isteğe bağlı küçültme ile). */
function tuvaleCiz(img, olcek = 1) {
  const G = Math.max(1, Math.round(img.naturalWidth * olcek))
  const Y = Math.max(1, Math.round(img.naturalHeight * olcek))
  const c = document.createElement('canvas')
  c.width = G
  c.height = Y
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, G, Y)
  return { canvas: c, ctx, G, Y, veri: ctx.getImageData(0, 0, G, Y) }
}

/**
 * Karenin beyaz fonlu stüdyo çekimi olup olmadığını sınar.
 *
 * Dosya boyutu yeterli bir ayraç değil — katalogda küçük boyutlu yaşam alanı
 * kareleri de var. Kesin ölçüt kenar halkası: stüdyo karesinde kenarlar
 * neredeyse tek renk ve açıktır, oda fotoğrafında değildir.
 */
function studyoMu(p, G, Y) {
  const l = []
  const al = (x, y) => {
    const i = (y * G + x) * 4
    l.push(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2])
  }
  for (let x = 0; x < G; x += 2) { al(x, 0); al(x, Y - 1) }
  for (let y = 0; y < Y; y += 2) { al(0, y); al(G - 1, y) }

  const ort = l.reduce((a, b) => a + b, 0) / l.length
  const sapma = Math.sqrt(l.reduce((a, b) => a + (b - ort) ** 2, 0) / l.length)
  return { studyo: ort > 224 && sapma < 14, parlaklik: +ort.toFixed(1), sapma: +sapma.toFixed(1) }
}

/** Kenar piksellerinden fon rengini ve gürültüsünü tahmin eder. */
function fonRengi(p, G, Y) {
  const ornekler = []
  let sr = 0, sg = 0, sb = 0
  const al = (x, y) => {
    const i = (y * G + x) * 4
    sr += p[i]; sg += p[i + 1]; sb += p[i + 2]
    ornekler.push([p[i], p[i + 1], p[i + 2]])
  }
  for (let x = 0; x < G; x += 3) { al(x, 0); al(x, Y - 1) }
  for (let y = 0; y < Y; y += 3) { al(0, y); al(G - 1, y) }

  const n = ornekler.length
  const ort = [sr / n, sg / n, sb / n]
  const sapma = Math.sqrt(
    ornekler.reduce((a, [r, g, b]) => a + renkFarki(r, g, b, ort[0], ort[1], ort[2]) ** 2, 0) / n
  )
  ort.sapma = sapma
  return ort
}

/** Kenarlardan taşma-doldurma: kenara bağlı fon piksellerini işaretler. */
function fonMaskesi(p, G, Y, fon, kati) {
  const [fr, fg, fb] = fon
  const maske = new Uint8Array(G * Y)
  const yigin = []
  for (let x = 0; x < G; x++) yigin.push(x, 0, x, Y - 1)
  for (let y = 0; y < Y; y++) yigin.push(0, y, G - 1, y)

  while (yigin.length) {
    const y = yigin.pop(), x = yigin.pop()
    if (x < 0 || y < 0 || x >= G || y >= Y) continue
    const k = y * G + x
    if (maske[k]) continue
    const i = k * 4
    if (renkFarki(p[i], p[i + 1], p[i + 2], fr, fg, fb) > kati) continue
    maske[k] = 1
    yigin.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  return maske
}

/**
 * Ürünün içinde kapalı kalan fon ceplerini siler.
 *
 * En tipik örnek: kitaplığın ayakları arasındaki stüdyo zemin yansıması.
 * Kenardan başlayan doldurma oraya ulaşamadığı için kesimde beyaz bir leke
 * kalır. Yalnızca BÜYÜK cepler silinir — kitap sayfası, beyaz yastık gibi
 * küçük açık renkli detaylar ürünün parçasıdır ve korunur.
 */
function fonCepleriniSil(maske, p, G, Y, fon, kati, parcaAlani) {
  const [fr, fg, fb] = fon
  const gorulen = new Uint8Array(G * Y)
  const enKucukCep = Math.max(400, parcaAlani * 0.004)

  const fonRenkli = (k) => {
    const i = k * 4
    return renkFarki(p[i], p[i + 1], p[i + 2], fr, fg, fb) <= kati
  }

  for (let bas = 0; bas < maske.length; bas++) {
    if (maske[bas] || gorulen[bas] || !fonRenkli(bas)) continue

    const yigin = [bas]
    const cep = [bas]
    gorulen[bas] = 1

    while (yigin.length) {
      const k = yigin.pop()
      const x = k % G, y = (k / G) | 0
      const komsular = []
      if (x > 0) komsular.push(k - 1)
      if (x < G - 1) komsular.push(k + 1)
      if (y > 0) komsular.push(k - G)
      if (y < Y - 1) komsular.push(k + G)
      for (const n of komsular) {
        if (gorulen[n] || maske[n] || !fonRenkli(n)) continue
        gorulen[n] = 1
        yigin.push(n)
        cep.push(n)
      }
    }

    if (cep.length >= enKucukCep) for (const k of cep) maske[k] = 1
  }
}

/**
 * Ön plandaki en büyük bağlantılı parçayı bulur.
 * Ödül rozetleri, kaçak lekeler ve ikincil nesneler böyle elenir.
 */
function enBuyukParca(maske, G, Y) {
  const etiket = new Int32Array(G * Y).fill(-1)
  let enIyi = { pikselSayisi: 0, id: -1, minX: 0, minY: 0, maxX: 0, maxY: 0, kenarTemas: 0 }
  let id = 0

  for (let bas = 0; bas < maske.length; bas++) {
    if (maske[bas] || etiket[bas] !== -1) continue

    const yigin = [bas]
    etiket[bas] = id
    let sayi = 0, minX = G, minY = Y, maxX = 0, maxY = 0, kenar = 0

    while (yigin.length) {
      const k = yigin.pop()
      const x = k % G, y = (k / G) | 0
      sayi++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x === 0 || y === 0 || x === G - 1 || y === Y - 1) kenar++

      if (x > 0 && !maske[k - 1] && etiket[k - 1] === -1) { etiket[k - 1] = id; yigin.push(k - 1) }
      if (x < G - 1 && !maske[k + 1] && etiket[k + 1] === -1) { etiket[k + 1] = id; yigin.push(k + 1) }
      if (y > 0 && !maske[k - G] && etiket[k - G] === -1) { etiket[k - G] = id; yigin.push(k - G) }
      if (y < Y - 1 && !maske[k + G] && etiket[k + G] === -1) { etiket[k + G] = id; yigin.push(k + G) }
    }

    if (sayi > enIyi.pikselSayisi) enIyi = { pikselSayisi: sayi, id, minX, minY, maxX, maxY, kenarTemas: kenar }
    id++
  }

  return { etiket, ...enIyi }
}

/**
 * Bir adayın AR'a uygunluğunu puanlar (küçük = iyi).
 * Hızlı olsun diye küçültülmüş kopya üzerinde çalışır.
 */
export async function adayPuani(src, gercekOran) {
  const img = await gorselYukle(src)
  const { veri, G, Y } = tuvaleCiz(img, 0.35)

  const st = studyoMu(veri.data, G, Y)
  if (!st.studyo) return { puan: 99, src, sebep: 'stüdyo karesi değil', ...st }

  const fon = fonRengi(veri.data, G, Y)
  const { kati } = esikler(fon.sapma)
  const maske = fonMaskesi(veri.data, G, Y, fon, kati)
  const parca = enBuyukParca(maske, G, Y)

  if (parca.pikselSayisi < G * Y * 0.005) return { puan: 99, src, sebep: 'ürün bulunamadı' }

  const en = parca.maxX - parca.minX + 1
  const boy = parca.maxY - parca.minY + 1
  const oran = en / boy

  // Kenara değiyorsa kare kırpılmış ya da kolaj demektir
  const kenarOrani = parca.kenarTemas / (2 * (G + Y))
  const oranSapmasi = gercekOran ? Math.abs(oran / gercekOran - 1) : 0
  // Çok küçük ya da ekranı dolduran parçalar da şüpheli
  const alanOrani = parca.pikselSayisi / (G * Y)
  const alanCezasi = alanOrani > 0.55 ? (alanOrani - 0.55) * 2 : 0

  return {
    puan: oranSapmasi + kenarOrani * 4 + alanCezasi,
    src,
    oranSapmasi: +oranSapmasi.toFixed(3),
    kenarOrani: +kenarOrani.toFixed(4),
  }
}

/** Aday kareler arasından AR'a en uygun olanı seçer. */
export async function enIyiAdaySec(gorseller, gercekOran) {
  const anahtar = gorseller.join('|')
  if (secimOnbellegi.has(anahtar)) return secimOnbellegi.get(anahtar)

  let enIyi = { puan: Infinity, src: gorseller[0] }
  for (const src of gorseller) {
    try {
      const p = await adayPuani(src, gercekOran)
      if (p.puan < enIyi.puan) enIyi = p
    } catch { /* aday okunamadı, sıradaki */ }
  }

  secimOnbellegi.set(anahtar, enIyi.src)
  return enIyi.src
}

/**
 * Kenar piksellerini ayıklar — "ürünün etrafındaki beyaz kalıntı"nın çözümü.
 *
 * Ürünün sınırındaki pikseller saf ürün rengi değil, ürün ile beyaz fonun
 * karışımıdır:  c = a·F + (1-a)·B
 * Bu pikselleri olduğu gibi bırakmak (ya da sadece saydamlaştırmak) ürünün
 * çevresinde beyaz bir hale bırakır — koyu bir koltuk açık bir duvarın
 * önüne konduğunda hemen göze çarpar.
 *
 * Yapılan iki şey:
 *   1. Örtüklük tahmini — a = (pikselin fondan uzaklığı) / (aynı bölgedeki
 *      saf ürün pikselinin fondan uzaklığı)
 *   2. Renk arındırma — F = (c - (1-a)·B) / a  ile fonun katkısı geri çıkarılır
 */
function kenarlariAyikla(p, maske, parca, G, Y, fon) {
  const YARICAP = 3
  const [fr, fg, fb] = fon

  // Maskeden içeriye doğru kaç piksel uzakta olduğumuz (0 = derin ürün)
  const uzaklik = new Uint8Array(G * Y)
  let sinir = []

  for (let k = 0; k < G * Y; k++) {
    if (maske[k] || parca.etiket[k] !== parca.id) continue
    const x = k % G, y = (k / G) | 0
    if ((x > 0 && maske[k - 1]) || (x < G - 1 && maske[k + 1]) ||
        (y > 0 && maske[k - G]) || (y < Y - 1 && maske[k + G])) {
      uzaklik[k] = 1
      sinir.push(k)
    }
  }

  for (let adim = 2; adim <= YARICAP; adim++) {
    const sonraki = []
    for (const k of sinir) {
      const x = k % G, y = (k / G) | 0
      for (const n of [x > 0 ? k - 1 : -1, x < G - 1 ? k + 1 : -1,
                       y > 0 ? k - G : -1, y < Y - 1 ? k + G : -1]) {
        if (n < 0 || maske[n] || uzaklik[n] || parca.etiket[n] !== parca.id) continue
        uzaklik[n] = adim
        sonraki.push(n)
      }
    }
    sinir = sonraki
  }

  const uzaklikTablosu = new Float32Array(G * Y)
  for (let k = 0; k < G * Y; k++) {
    if (p[k * 4 + 3] === 0) continue
    const i = k * 4
    uzaklikTablosu[k] = renkFarki(p[i], p[i + 1], p[i + 2], fr, fg, fb)
  }

  const PENCERE = 4
  for (let k = 0; k < G * Y; k++) {
    if (!uzaklik[k]) continue
    const x = k % G, y = (k / G) | 0

    // Yakındaki saf ürün pikselinin fondan uzaklığı = tam örtüklük referansı
    let referans = 0
    const x0 = Math.max(0, x - PENCERE), x1 = Math.min(G - 1, x + PENCERE)
    const y0 = Math.max(0, y - PENCERE), y1 = Math.min(Y - 1, y + PENCERE)
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const n = yy * G + xx
        if (uzaklik[n] || p[n * 4 + 3] === 0) continue
        if (uzaklikTablosu[n] > referans) referans = uzaklikTablosu[n]
      }
    }

    const i = k * 4
    if (referans < 12) continue // çevresi de fona yakın (beyaz ürün) — dokunma

    const a = Math.min(1, uzaklikTablosu[k] / referans)
    p[i + 3] = Math.round(255 * a)
    if (a < 0.02) { p[i + 3] = 0; continue }

    // Fonun katkısını geri çıkar
    p[i] = Math.max(0, Math.min(255, (p[i] - (1 - a) * fr) / a))
    p[i + 1] = Math.max(0, Math.min(255, (p[i + 1] - (1 - a) * fg) / a))
    p[i + 2] = Math.max(0, Math.min(255, (p[i + 2] - (1 - a) * fb) / a))
  }
}

/**
 * Kesimin en altında kalan stüdyo gölgesi kalıntısını yumuşatarak siler.
 *
 * Bu bölge fona çok yakın ama tam eşiğin içinde değil; bırakılırsa ürünün
 * altında soluk beyaz bir leke olarak görünür. Sahnedeki gölgeyi zaten
 * perspektife göre biz çiziyoruz (ar.js), bu kalıntıya ihtiyaç yok.
 * Koyu ayaklar fondan uzak olduğu için etkilenmez.
 */
function golgeKalintisiniSoldur(ctx, G, Y, fon) {
  const parlaklik = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b
  const fonParlakligi = parlaklik(fon[0], fon[1], fon[2])

  const tumu = ctx.getImageData(0, 0, G, Y)
  const p = tumu.data

  // Ürünün kendi rengi ne kadar koyu? Gölgeyi ne kadar agresif
  // silebileceğimizi bu belirliyor.
  const ustBolge = Math.floor(Y * 0.6)
  const ornekler = []
  for (let k = 0; k < ustBolge * G; k += 7) {
    const i = k * 4
    if (p[i + 3] > 200) ornekler.push(parlaklik(p[i], p[i + 1], p[i + 2]))
  }
  if (!ornekler.length) return
  ornekler.sort((a, b) => a - b)
  const ortancaParlaklik = ornekler[Math.floor(ornekler.length / 2)]
  const koyuUrun = ortancaParlaklik < fonParlakligi - 55

  /*
   * Zemindeki parlama "beyaz gölcük" olarak kalıyordu: gölcüğün çevresindeki
   * gri gölge halkası, kenardan gelen taşma-doldurmayı bloke ediyor ve gölcük
   * kesimin parçası sayılıyordu. Bant bazlı soldurma yeterince agresif değildi.
   *
   * Yeni kural: alt bölgede fona yakın parlaklıkta ve renksiz (doygunluğu
   * düşük) HİÇBİR piksel ürün değildir → tamamen silinir.
   *
   *  - Koyu/renkli üründe (koltuk, ahşap sehpa, turuncu berjer) bu güvenlidir;
   *    ürünün kendisi ya koyu ya doygun renklidir. Geniş eşik + geniş bölge.
   *  - Beyaz üründe (GINA sandalye, beyaz komodin gövdesi) ürünün kendisi de
   *    fona yakındır; orada yalnızca fona ÇOK yakın pikseller silinir ki
   *    beyaz ayaklar sağ kalsın.
   */
  const bolge = Math.max(4, Math.round(Y * 0.45))
  const bas = Y - bolge

  for (let y = bas; y < Y; y++) {
    for (let x = 0; x < G; x++) {
      const i = (y * G + x) * 4
      const a = p[i + 3]
      if (a === 0) continue
      const r = p[i], g = p[i + 1], b = p[i + 2]
      const l = parlaklik(r, g, b)
      const doygunluk = Math.max(r, g, b) - Math.min(r, g, b)

      // Yarı saydam pikselin rengi kenar ayıklamada arındırıldığı için
      // güvenilmez (doygunluğu yapay şişebilir). Alt bölgede parlak ve yarı
      // saydam olan her şey gölge/parlaklık artığıdır.
      if (a < 250) {
        if (l > fonParlakligi - 85) p[i + 3] = 0
        continue
      }

      if (koyuUrun) {
        // Ürün koyu/renkli: fona yakın parlaklıkta renksiz piksel ürün olamaz
        if (doygunluk < 24 && l >= fonParlakligi - 65) p[i + 3] = 0
      } else {
        // Ürün beyaz: parlak pikseller ürünün kendisi olabilir (beyaz ayak),
        // onlara dokunma. Aradaki GRİ gölge bandını yalnızca en alt %25'te sil.
        const enAlt = y >= Y - Math.max(3, Math.round(Y * 0.25))
        if (enAlt && doygunluk < 15 && l < fonParlakligi - 25 && l > fonParlakligi - 85) p[i + 3] = 0
      }
    }
  }

  ctx.putImageData(tumu, 0, 0)
}

/** Tuvali görünür (alfa > 12) piksellerin sınırına kadar kırpar. */
function sonKirp(kaynak) {
  const G = kaynak.width, Y = kaynak.height
  const p = kaynak.getContext('2d').getImageData(0, 0, G, Y).data
  let minX = G, minY = Y, maxX = -1, maxY = -1

  for (let y = 0; y < Y; y++) {
    for (let x = 0; x < G; x++) {
      if (p[(y * G + x) * 4 + 3] > 12) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return { canvas: kaynak, en: G, boy: Y }
  const en = maxX - minX + 1
  const boy = maxY - minY + 1
  if (en === G && boy === Y) return { canvas: kaynak, en, boy }

  const c = document.createElement('canvas')
  c.width = en
  c.height = boy
  c.getContext('2d').drawImage(kaynak, minX, minY, en, boy, 0, 0, en, boy)
  return { canvas: c, en, boy }
}

/**
 * Tam çözünürlükte şeffaf kesim üretir.
 * @returns {Promise<{canvas: HTMLCanvasElement, en: number, boy: number}>}
 */
export async function kesimUret(src) {
  if (onbellek.has(src)) return onbellek.get(src)

  const img = await gorselYukle(src)
  const { canvas, ctx, G, Y, veri } = tuvaleCiz(img, 1)
  const p = veri.data

  const fon = fonRengi(p, G, Y)
  const { kati } = esikler(fon.sapma)
  const maske = fonMaskesi(p, G, Y, fon, kati)
  let parca = enBuyukParca(maske, G, Y)

  // Ürünün içinde kapalı kalan büyük fon ceplerini temizle, sonra parçayı
  // yeniden hesapla (kutu küçülmüş olabilir).
  fonCepleriniSil(maske, p, G, Y, fon, kati, parca.pikselSayisi)
  parca = enBuyukParca(maske, G, Y)

  // En büyük parça dışındaki her şeyi sil (rozetler, lekeler)
  for (let k = 0; k < G * Y; k++) {
    if (maske[k] || parca.etiket[k] !== parca.id) p[k * 4 + 3] = 0
  }

  kenarlariAyikla(p, maske, parca, G, Y, fon)

  ctx.putImageData(veri, 0, 0)

  // Görünür alana kırp: fotoğraftaki boş beyaz alan ürünün ölçüsüne girmemeli
  const kEn = Math.max(1, parca.maxX - parca.minX + 1)
  const kBoy = Math.max(1, parca.maxY - parca.minY + 1)
  const kirp = document.createElement('canvas')
  kirp.width = kEn
  kirp.height = kBoy
  const kctx = kirp.getContext('2d', { willReadFrequently: true })
  kctx.drawImage(canvas, parca.minX, parca.minY, kEn, kBoy, 0, 0, kEn, kBoy)

  golgeKalintisiniSoldur(kctx, kEn, kBoy, fon)

  // Gölge temizliği en alttaki pikselleri sildiği için dokunun altında boş
  // şeffaf bir bant kalabiliyor. Yeniden kırpılmazsa ürün AR'da o bant kadar
  // HAVADA durur: model tabanı zemine oturur ama görünür kısım yukarıda başlar.
  const son = sonKirp(kirp)

  const sonuc = { canvas: son.canvas, en: son.en, boy: son.boy }
  onbellek.set(src, sonuc)
  return sonuc
}
