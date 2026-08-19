/**
 * Uygulama kabuğu: banner, ürün vitrini ve AR ekranı arasındaki akış.
 *
 * Senaryo: kullanıcı ana sayfadaki banner'a dokunur → kamera açılır →
 * ürün gerçek ölçüsüyle odaya yerleşir.
 */
import { ArSahne } from './ar.js'
// Sürüm damgası: her yayında artırılır. Tüm iç kaynaklar bu damgayla
// istendiği için telefonlardaki eski önbellek asla yeni sayfayla karışmaz.
const SURUM = '25'

// Ürün kartlarındaki AR rozeti — <a rel=ar> içindeki tek <img> olarak
// kullanılır, dokunuş Quick Look'u doğrudan kamera modunda açar.
const AR_ROZET =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="24">' +
    '<rect width="44" height="24" rx="5" fill="rgba(22,22,26,0.85)"/>' +
    '<text x="22" y="16.5" font-family="-apple-system,Helvetica,sans-serif" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">⌾ AR</text>' +
    '</svg>'
  )

// Gerçek hacimli 3D modeli olan ürünlerin rozeti — vitrinde göze çarpsın
const AR_ROZET_3D =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="86" height="24">' +
    '<rect width="86" height="24" rx="5" fill="#0d7a4f"/>' +
    '<circle cx="12" cy="12" r="3" fill="#7dffc0"/>' +
    '<text x="49" y="16.5" font-family="-apple-system,Helvetica,sans-serif" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">GERÇEK 3D</text>' +
    '</svg>'
  )

// "Odaya Sabitle" butonunun tüm yüzü — <a rel=ar> içindeki tek GÖRÜNÜR <img>.
// Görünmez görsel Safari'nin AR linki denetiminden geçmiyor; rozetle aynı
// desen: ikon + yazı tek SVG'de.
const ODAYA_SABITLE_IMG =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 52">' +
    '<rect x="35" y="6" width="14" height="14" rx="3" fill="none" stroke="#16161a" stroke-width="1.8" stroke-dasharray="3.5 2.5"/>' +
    '<g fill="#16161a" font-family="-apple-system,Helvetica,sans-serif" font-size="10.5" font-weight="700" text-anchor="middle">' +
    '<text x="42" y="35">Odaya</text><text x="42" y="47">Sabitle</text></g>' +
    '</svg>'
  )

import { kesimUret } from './cutout.js'
import { duzlemGlbUret, gercekArDestekliMi } from './glb.js'

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]

const durum = {
  urunler: [],
  sahneler: [],
  aktifKategori: 'Hepsi',
  arListesi: [],
  arIndeks: 0,
  sahneIndeks: 0,
  kameraVar: false,
}

const paraFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Fiyatı olmayan tek ürün, hedef kaliteyi temsil eden örnek 3D model
const fiyatYaz = (f) => (f ? `${paraFormat.format(f)} TL` : 'Örnek 3D Model')
const olcuYaz = (u) =>
  `${Math.round(u.genislikMm / 10)} × ${Math.round(u.derinlikMm / 10)} × ${Math.round(u.yukseklikMm / 10)} cm`

let ar

// --------------------------------------------------------------- başlangıç

async function basla() {
  const [urunVeri, odaVeri] = await Promise.all([
    fetch('data/products.json?s=' + SURUM).then((r) => r.json()),
    fetch('data/rooms.json?s=' + SURUM).then((r) => r.json()).catch(() => ({ sahneler: [] })),
  ])

  // Ölçüsü tam VE katalog karesi AR'a uygun ürünler (bkz. tools/qualify.mjs)
  const olculu = urunVeri.urunler.filter((u) => u.genislikMm && u.yukseklikMm && u.derinlikMm)
  durum.urunler = olculu.filter((u) => u.arUygun)
  durum.elenen = olculu.length - durum.urunler.length
  durum.sahneler = odaVeri.sahneler || []

  if (uygulamaIciTarayici()) {
    $('#tarayici-uyari').classList.remove('gizli')
    $('#uyari-kapat').addEventListener('click', () => $('#tarayici-uyari').classList.add('gizli'))
  }

  // Ekranda hangi sürümün çalıştığı görünür olsun — önbellek şüphesinde
  // "hangi sürümdesin" sorusunun cevabı tek bakışta alınır.
  const dip = document.querySelector('.dip-not')
  if (dip) dip.textContent += ` · Demo sürüm ${SURUM}`

  bannerCiz()
  ciplerCiz()
  izgaraCiz()
  if (durum.elenen) {
    $('#eleme-notu').textContent =
      `${durum.urunler.length} ürün AR'a hazır. ${durum.elenen} üründe katalog karesi uygun değil ` +
      `(kolaj, ödül rozeti ya da salon çekimi) — bunlar 3D model ister.`
  }
  olaylariBagla()

  ar = new ArSahne({ tuval: $('#sahne'), video: $('#kamera'), fonGorsel: $('#oda-fonu') })

  // Reklamdan geliş (?urun=SKU): KURAL MUTLAK — reklamın neresine basılırsa
  // basılsın kamera açılır. Ara kart, ikinci buton, detay sayfası YOK.
  // (iOS'ta reklamdaki hap zaten doğrudan Quick Look açar; gövdeye basan da
  // burada anında 2.5D kamera deneyimine düşer, gerçek AR'a "Odaya Sabitle"
  // ile tek dokunuş uzaklıktadır.)
  const parametreler = new URLSearchParams(location.search)
  const kampanyaSku = parametreler.get('urun')
  const kampanyaUrunu = kampanyaSku && durum.urunler.find((u) => u.sku === kampanyaSku)
  if (kampanyaUrunu) arAc([kampanyaUrunu], 0)

  // Sunum sırasında konsoldan ayar denemek için (kamera yüksekliği, görüş açısı vb.)
  window.__demo = { ar, durum }
}

/**
 * Reklamdan gelinen tek ürünlük kampanya sayfası.
 * iOS'ta "Odanda Dene" gerçek AR linki (tek dokunuş → kamera);
 * diğer platformlarda AR ekranını açar.
 */
function kampanyaGoster(u) {
  $('#kampanya-gorsel').src = u.gorsel
  $('#kampanya-ad').textContent = u.ad
  $('#kampanya-detay').textContent = (u.tur || u.kategori) + ' · ' + olcuYaz(u)
  $('#kampanya-fiyat').textContent = fiyatYaz(u.fiyat)

  const kap = $('#kampanya-ar')
  if (iosMu() && u.usdz) {
    kap.innerHTML = `<a rel="ar" href="${quickLookHref(u)}"><img src="${ODANDA_HAPI}" alt="Odanda Dene"></a>`
  } else {
    kap.innerHTML = `<button class="kampanya-buton">⌾ Odanda Dene</button>`
    kap.firstElementChild.addEventListener('click', () => {
      $('#kampanya').classList.add('gizli')
      arAc([u], 0)
    })
  }

  $('#kampanya-vitrin').addEventListener('click', () => $('#kampanya').classList.add('gizli'), { once: true })
  $('#kampanya').classList.remove('gizli')
  modeliIsit(u)
}

// ------------------------------------------------------------------ vitrin

/** Banner slaytları — her slayt bir kampanya + arkasında AR'a bağlı bir ürün. */
function bannerCiz() {
  const oneCikan = [
    { kategori: 'Koltuk', etiket: 'GERÇEK 3D MODEL', baslik: 'ATELIER', alt: 'Kameranla odana yerleştir, etrafında dolaş' },
    { kategori: 'Yemek Masası', etiket: 'YEMEK ODASI', baslik: 'Masalar', alt: 'Odana sığacak mı? Kamerayla ölç' },
    { kategori: 'Berjer', etiket: 'TAMAMLAYICI', baslik: 'Berjerler', alt: 'Boş köşen için doğru berjeri seç' },
    { kategori: 'Kitaplık', etiket: 'DÜZEN', baslik: 'Kitaplıklar', alt: 'Duvarında ne kadar yer kaplar?' },
  ]

  const kap = $('#banner-slaytlar')
  const noktalar = $('#banner-noktalar')

  oneCikan.forEach((s, i) => {
    const urun = durum.urunler.find((u) => u.kategori === s.kategori)
    if (!urun) return
    const sahne = durum.sahneler[i % Math.max(1, durum.sahneler.length)]

    // iOS'ta "Kamerayla Dene" hapı gerçek AR linki: banner'dan TEK dokunuşla
    // kamera açılır. Diğer platformlarda slayt eski akışla AR ekranını açar.
    const hap =
      iosMu() && urun.usdz
        ? `<a class="slayt-btn-ar" rel="ar" href="${quickLookHref(urun)}"><img src="${KAMERA_HAPI}" alt="Kamerayla Dene"></a>`
        : `<span class="slayt-btn"><i>⌾</i> Kamerayla Dene</span>`

    const el = document.createElement('div')
    el.className = 'slayt'
    el.setAttribute('role', 'button')
    // Hero (gerçek 3D örnek) kendi render'ıyla çıkar; diğer slaytlar oda sahnesiyle
    const slaytGorseli = urun.sku === 'DEMO3D' ? urun.gorsel : (sahne ? sahne.dosya : urun.gorsel)
    el.innerHTML = `
      <img src="${slaytGorseli}" alt="" ${urun.sku === 'DEMO3D' ? 'style="object-fit:contain;background:#ece7df;padding:18px 0"' : ''}>
      <div class="ar-etiket">ODANDA DENE</div>
      <div class="slayt-katman">
        <div class="slayt-ust-etiket">${s.etiket}</div>
        <h3>${s.baslik}</h3>
        <p>${s.alt}</p>
        ${hap}
      </div>`
    el.addEventListener('click', () => arAc(durum.urunler.filter((u) => u.kategori === s.kategori), 0))
    el.querySelector('a.slayt-btn-ar')?.addEventListener('click', (e) => e.stopPropagation())
    kap.appendChild(el)

    // Banner ürünleri en olası dokunuşlar — modellerini önceden ısıt
    setTimeout(() => modeliIsit(urun), 2500 + i * 800)

    const nokta = document.createElement('i')
    if (i === 0) nokta.className = 'aktif'
    noktalar.appendChild(nokta)
  })

  kap.addEventListener('scroll', () => {
    const i = Math.round(kap.scrollLeft / kap.clientWidth)
    $$('#banner-noktalar i').forEach((n, j) => n.classList.toggle('aktif', j === i))
  })
}

function ciplerCiz() {
  const kategoriler = ['Hepsi', ...new Set(durum.urunler.map((u) => u.kategori))]
  const kap = $('#cipler')
  kap.innerHTML = ''
  for (const k of kategoriler) {
    const b = document.createElement('button')
    b.className = 'cip' + (k === durum.aktifKategori ? ' aktif' : '')
    b.textContent = k
    b.addEventListener('click', () => {
      durum.aktifKategori = k
      ciplerCiz()
      izgaraCiz()
    })
    kap.appendChild(b)
  }
}

function filtreliUrunler() {
  return durum.aktifKategori === 'Hepsi'
    ? durum.urunler
    : durum.urunler.filter((u) => u.kategori === durum.aktifKategori)
}

function izgaraCiz() {
  const liste = filtreliUrunler()
  const kap = $('#izgara')
  kap.innerHTML = ''

  liste.forEach((u, i) => {
    // <a> bir <button> içinde geçersiz olduğu için kart bir <div>
    const b = document.createElement('div')
    b.className = 'kart'
    b.setAttribute('role', 'button')
    b.tabIndex = 0

    // iOS'ta rozet gerçek bir AR linkidir (tek <img> = rozetin kendisi):
    // dokunuş Quick Look'u doğrudan kamera modunda açar, vitrinden tek adım.
    const rozetGorseli = u.gercek3D ? AR_ROZET_3D : AR_ROZET
    const rozet =
      iosMu() && u.usdz
        ? `<a class="kart-ar" rel="ar" href="${quickLookHref(u)}"><img src="${rozetGorseli}" alt="AR" style="width:auto"></a>`
        : u.gercek3D
          ? `<span class="kart-ar kart-ar-3d">● GERÇEK 3D</span>`
          : `<span class="kart-ar">⌾ AR</span>`

    b.innerHTML = `
      <div class="kart-gorsel">
        <img src="${u.gorsel}" alt="${u.ad}" loading="lazy">
        ${rozet}
      </div>
      <div class="kart-ad">${u.ad}</div>
      <div class="kart-tur">${u.tur || u.kategori}</div>
      <div class="kart-olcu">${olcuYaz(u)}</div>
      <div class="kart-fiyat">${fiyatYaz(u.fiyat)}</div>`

    b.addEventListener('click', () => arAc(liste, i))
    // Rozete dokunuş yalnızca AR'ı açsın, altta ekran değişmesin
    b.querySelector('a.kart-ar')?.addEventListener('click', (e) => e.stopPropagation())
    kap.appendChild(b)
  })
}

// ---------------------------------------------------------------- AR akışı

async function arAc(liste, indeks) {
  durum.arListesi = liste
  durum.arIndeks = indeks

  $('#vitrin').classList.add('gizli')
  $('#ar').classList.remove('gizli')
  ar.tazeleBoyut()

  // Tek dokunuşta TEK izin: kamera. iOS, bir izin istemi ekrandayken
  // gelen ikinci istemi (hareket sensörü) sessizce reddediyor — ikisini
  // birden istemek kameranın hiç açılmamasına yol açıyordu. Sensör izni,
  // kendi dokunuşu olan ⌖ Sabitle butonunda isteniyor.
  await kamerayiAc()
  arUrunSeridiCiz()
  await arUrunuYukle()

  ar.baslat()
  const gercekAr = await gercekArButonunuTazele()
  // Kamera açılamadıysa ipucunda TEŞHİS mesajı duruyor — üzerine yazma ve
  // soldurma; kullanıcının (ve bizim) onu okuyabilmesi lazım.
  if (gercekAr && durum.kameraVar) {
    $('#ar-ipucu').textContent = iosMu()
      ? '⬚ Odaya Sabitle — kamera doğrudan açılır'
      : 'Zemine tam oturması için: ⬚ Odaya Sabitle'
  }
  sabitDugmesiTazele()

  const ipucu = $('#ar-ipucu')
  ipucu.style.opacity = '1'
  clearTimeout(arAc._zaman)
  if (durum.kameraVar) {
    arAc._zaman = setTimeout(() => (ipucu.style.opacity = '0'), 4500)
  }
}

function arKapat() {
  ar.durdur()
  const akis = $('#kamera').srcObject
  if (akis) akis.getTracks().forEach((t) => t.stop())
  $('#kamera').srcObject = null
  $('#ar').classList.add('gizli')
  $('#vitrin').classList.remove('gizli')
}

/** Arka kamerayı açar; yoksa örnek oda sahnelerine düşer. */
async function kamerayiAc() {
  const video = $('#kamera')
  try {
    let akis
    try {
      akis = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
    } catch (ilkHata) {
      // Quick Look'tan yeni çıkıldıysa iOS kamerayı kısa süre meşgul tutabiliyor
      // (NotReadableError). Reddedilmediyse bir nefes bekleyip tekrar dene.
      if (ilkHata?.name === 'NotAllowedError') throw ilkHata
      await new Promise((r) => setTimeout(r, 900))
      akis = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
    }
    video.srcObject = akis
    await video.play()
    video.classList.add('acik')
    $('#oda-fonu').classList.remove('acik')
    $('#sahne-secici').classList.add('gizli')
    durum.kameraVar = true
  } catch (hata) {
    durum.kameraVar = false
    video.classList.remove('acik')
    $('#oda-fonu').classList.add('acik')
    sahneSeciciCiz()
    sahneUygula(durum.sahneIndeks)
    // İzin daha önce reddedildiyse iOS bir daha SORMAZ — kullanıcıya nereden
    // açacağını söylemezsek "kamera bozuk" sanır.
    $('#ar-ipucu').textContent =
      hata?.name === 'NotAllowedError'
        ? 'Kamera izni kapalı — adres çubuğundaki AA menüsü → Web Sitesi Ayarları → Kamera → İzin Ver'
        : `Kamera açılamadı (${hata?.name || 'bilinmiyor'}) — örnek oda sahnesi kullanılıyor`
  }
}

function sahneSeciciCiz() {
  const kap = $('#sahne-secici')
  if (!durum.sahneler.length) return
  kap.classList.remove('gizli')
  kap.innerHTML = ''
  durum.sahneler.forEach((s, i) => {
    const img = document.createElement('img')
    img.src = s.dosya
    img.className = i === durum.sahneIndeks ? 'aktif' : ''
    img.addEventListener('click', () => sahneUygula(i))
    kap.appendChild(img)
  })
}

function sahneUygula(i) {
  durum.sahneIndeks = i
  const s = durum.sahneler[i]
  if (!s) return
  $('#oda-fonu').src = s.dosya
  $$('#sahne-secici img').forEach((el, j) => el.classList.toggle('aktif', j === i))

  // Katalog sahneleri ~1.2 m yükseklikten, hafif eğimle çekilmiş.
  ar.kamera.yukseklikM = 1.2
  ar.kamera.pitch = 4 * (Math.PI / 180)
  ar.kamera.fovDikey = 46 * (Math.PI / 180)
  ar.sabitlemeyiAyarla(false)
  ar.ilkCercevele()
}

function arUrunSeridiCiz() {
  const kap = $('#ar-urunler')
  kap.innerHTML = ''
  durum.arListesi.forEach((u, i) => {
    const b = document.createElement('button')
    b.className = 'ar-urun' + (i === durum.arIndeks ? ' aktif' : '')
    b.innerHTML = `<img src="${u.gorsel}" alt="${u.ad}">`
    b.addEventListener('click', async () => {
      durum.arIndeks = i
      $$('.ar-urun').forEach((el, j) => el.classList.toggle('aktif', j === i))
      await arUrunuYukle()
    })
    kap.appendChild(b)
  })
}

/**
 * Ürünün hangi yüzeye konacağını belirler.
 * Vazo gibi dekoratif ürünler zemine değil masa/konsol üstüne konur — ARKit ve
 * ARCore de düzlemleri "zemin" ve "masa üstü" diye ayırır.
 */
function yerlestirmeYuzeyi(u) {
  const masaUstu = ['Vazo'].includes(u.kategori) || u.yukseklikMm < 550
  return masaUstu ? 0.75 : 0
}

async function arUrunuYukle() {
  const u = durum.arListesi[durum.arIndeks]
  $('#ar-baslik').innerHTML = `<strong>${u.ad}</strong><span>${olcuYaz(u)}</span>`
  $('#ar-fiyat-tutar').textContent = fiyatYaz(u.fiyat)
  $('#ar-fiyat-olcu').textContent = `${u.tur || u.kategori} · ${olcuYaz(u)}`

  // Uygun kare eleme aşamasında seçildi (tools/qualify.mjs) — burada sadece kes
  const kesim = await kesimUret(u.arGorsel || u.gorsel)
  ar.urunAyarla(u, kesim, yerlestirmeYuzeyi(u))
  cevirDugmesiTazele()
  gercekArButonunuTazele()
  modeliIsit(u) // Odaya Sabitle'ye dokunmadan model hazır olsun
}

/**
 * Telefonda hareket sensörünün gerçekten okunup okunmadığını gösterir.
 * "İzin verdim ama ürün yerinde durmuyor" durumunu ayırt etmenin tek yolu bu:
 * eğim değeri telefonu oynattıkça değişiyorsa sensör çalışıyordur.
 */
function sensorDurumuYaz() {
  const el = $('#kal-sensor')
  if (!el) return
  const derece = (r) => Math.round((r * 180) / Math.PI)
  if (!ar.sensorTuru) {
    el.textContent = 'Hareket sensörü yok ya da izin verilmedi — eğim elle ayarlanıyor.'
    el.classList.add('yok')
    return
  }
  el.classList.remove('yok')
  el.textContent = `Sensör çalışıyor (${ar.sensorTuru}) · eğim ${derece(ar.kamera.pitch)}° · yön ${derece(ar.kamera.yaw)}°`
}

/**
 * Konum takipli gerçek AR'a geçer.
 *
 * Ürünün kesimi anında bir GLB'ye çevrilip ARCore/WebXR oturumuna verilir.
 * Fark şu: cihaz sensörüyle yapılan sabitleme yalnızca dönmeyi telafi eder,
 * kullanıcı yürüdüğünde ürün kayar. Burada konum da takip edildiği için ürün
 * odada gerçekten sabit kalır ve etrafında dolaşılabilir.
 */
/**
 * "Odaya Sabitle" butonunu aktif ürüne göre hazırlar.
 *
 * Gerçek zemin algılama: Android'de Scene Viewer (GLB), iPhone'da Quick Look
 * (USDZ). Android'de WebXR bayrağına bakılmaz — Scene Viewer, WebXR kapalı
 * cihazlarda da çalışır. iOS'ta butonun href'i doğrudan USDZ'ye bağlanır;
 * dokunuş linke doğal gittiği için Quick Look AR sekmesi tam yetkili açılır.
 */
async function gercekArButonunuTazele() {
  const u = durum.arListesi[durum.arIndeks]
  const kap = $('#btn-gercek-ar-kap')
  const link = $('#btn-gercek-ar')
  $('#btn-gercek-ar-img').src = ODAYA_SABITLE_IMG

  let var_ = false
  if (iosMu()) {
    var_ = !!u?.usdz
    if (var_) {
      link.rel = 'ar'
      link.setAttribute('href', quickLookHref(u))
    } else {
      link.removeAttribute('href')
      link.removeAttribute('rel')
    }
  } else if (/android/i.test(navigator.userAgent)) {
    var_ = !!u?.glb
  } else {
    var_ = await gercekArDestekliMi()
  }

  kap.classList.toggle('gizli', !var_)
  kap.classList.toggle('one-cikar', var_)
  return var_
}

/**
 * Quick Look bağlantısı: AR görünümünün altında ürün adı, fiyatı ve
 * "Sepete Ekle" düğmesi görünür (Apple'ın banner parametreleri).
 * Kamera + ürün + fiyat + satın alma tek ekranda — vitrin cümlesi bu.
 */
function quickLookHref(u) {
  const parca = new URLSearchParams({
    callToAction: 'Sepete Ekle',
    checkoutTitle: u.ad,
    checkoutSubtitle: (u.tur || u.kategori) + ' · ' + olcuYaz(u),
    price: fiyatYaz(u.fiyat),
    canonicalWebPageURL: location.origin + location.pathname,
  })
  return `${u.usdz}?s=${SURUM}#${parca.toString()}`
}

const iosMu = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// Banner'daki "Kamerayla Dene" hapı — rozetle aynı desen: <a rel=ar> içinde
// tek görünür SVG. Reklam görselinden TEK dokunuşla kamera; Begüm'ün
// ilk mesajındaki senaryonun kendisi.
const KAMERA_HAPI =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="176" height="40">' +
    '<rect width="176" height="40" rx="20" fill="#ffffff"/>' +
    '<text x="88" y="25.5" font-family="-apple-system,Helvetica,sans-serif" font-size="13" font-weight="600" fill="#16161a" text-anchor="middle">⌾  Kamerayla Dene</text>' +
    '</svg>'
  )

// Kampanya sayfasındaki koyu "Odanda Dene" hapı (beyaz zemin üstüne)
const ODANDA_HAPI =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="216" height="52">' +
    '<rect width="216" height="52" rx="26" fill="#16161a"/>' +
    '<text x="108" y="32.5" font-family="-apple-system,Helvetica,sans-serif" font-size="15" font-weight="600" fill="#ffffff" text-anchor="middle">⌾  Odanda Dene</text>' +
    '</svg>'
  )

// Ön-yükleme: kullanıcı henüz dokunmadan USDZ arka planda indirilir; Quick
// Look açıldığında model tarayıcı önbelleğinden gelir, bekleme kalmaz.
const isitilanlar = new Set()
function modeliIsit(u) {
  if (!u?.usdz || isitilanlar.has(u.sku)) return
  isitilanlar.add(u.sku)
  fetch(u.usdz + '?s=' + SURUM, { priority: 'low' }).catch(() => isitilanlar.delete(u.sku))
}

/**
 * WhatsApp/Instagram/Facebook içi tarayıcı tespiti.
 * Apple bu kabuk tarayıcılarda ARKit'i kapalı tutar: Quick Look açılır ama
 * üstteki "AR" sekmesi soluk kalır. Tek çözüm linki Safari'de açmak.
 */
const uygulamaIciTarayici = () =>
  /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Line\/|Twitter/i.test(navigator.userAgent)

async function gercekAraGec(e) {
  const u = durum.arListesi[durum.arIndeks]
  const kap = $('#btn-gercek-ar-kap')

  // iOS: dokunuş, kaplama <a rel=ar>'a doğal gider — Quick Look doğrudan
  // kamera modunda açılır. JS'in karışmaması gerekir.
  if (iosMu()) {
    if (!$('#btn-gercek-ar').getAttribute('href')) {
      e.preventDefault()
      $('#ar-ipucu').textContent = 'Bu ürün için iOS modeli hazır değil'
      $('#ar-ipucu').style.opacity = '1'
    }
    return
  }

  e.preventDefault()
  kap.style.opacity = '0.5' // hazırlanıyor göstergesi

  try {
    const mv = $('#mv-canli')

    // Önceden üretilmiş GLB dosyası varsa onu kullan. Şart çünkü Android'de
    // AR oturumunu Scene Viewer adlı ayrı uygulama açar ve ona yalnızca
    // gerçek bir https adresi verilebilir; çalışma anındaki blob: adresi
    // orada açılmaz (belirti: yeni ekran gelir ama içi boş kalır).
    if (u.glb) {
      mv.src = new URL(u.glb, location.href).href
    } else {
      const kesim = await kesimUret(u.arGorsel || u.gorsel)
      mv.src = await duzlemGlbUret(kesim.canvas, u.genislikMm / 1000, u.yukseklikMm / 1000)
    }

    await new Promise((coz, red) => {
      mv.addEventListener('load', coz, { once: true })
      mv.addEventListener('error', red, { once: true })
      setTimeout(red, 8000)
    })
    await mv.activateAR()
    $('#ar-ipucu').textContent =
      'Kamerayı zemine veya masaya doğrult — düzlem algılanınca ürün oturur'
    $('#ar-ipucu').style.opacity = '1'
  } catch {
    $('#ar-ipucu').textContent = 'Gerçek AR başlatılamadı — cihaz desteklemiyor olabilir'
    $('#ar-ipucu').style.opacity = '1'
  } finally {
    kap.style.opacity = ''
  }
}

function sabitDugmesiTazele() {
  $('#btn-sabit').classList.toggle('aktif', ar.dunyayaSabit)
}
function cevirDugmesiTazele() {
  $('#btn-cevir').classList.toggle('aktif', ar.aynala)
}

// ------------------------------------------------------------------ olaylar

function olaylariBagla() {
  $('#ar-kapat').addEventListener('click', arKapat)

  $('#btn-olcu').addEventListener('click', (e) => {
    ar.olcuModu = !ar.olcuModu
    e.currentTarget.classList.toggle('aktif', ar.olcuModu)
  })

  $('#btn-cevir').addEventListener('click', () => {
    ar.aynala = !ar.aynala
    cevirDugmesiTazele()
  })

  $('#btn-sabit').addEventListener('click', async () => {
    if (!ar.dunyayaSabit) {
      const oldu = await ar.yonelimiBagla()
      if (!oldu) {
        $('#ar-ipucu').textContent = 'Bu cihazda yönelim sensörü yok — ürün ekrana sabit'
        $('#ar-ipucu').style.opacity = '1'
      }
    } else {
      ar.sabitlemeyiAyarla(false)
    }
    sabitDugmesiTazele()
  })

  $('#btn-foto').addEventListener('click', async () => {
    const blob = await ar.fotografCek()
    if (!blob) return
    const u = durum.arListesi[durum.arIndeks]
    const dosya = new File([blob], `enza-${u.ad.toLowerCase()}.jpg`, { type: 'image/jpeg' })

    if (navigator.canShare?.({ files: [dosya] })) {
      try {
        await navigator.share({ files: [dosya], title: `${u.ad} · Enza Home` })
        return
      } catch { /* kullanıcı vazgeçti */ }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = dosya.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  })

  $('#btn-kal').addEventListener('click', (e) => {
    const kapali = $('#kalibrasyon').classList.toggle('gizli')
    e.currentTarget.classList.toggle('aktif', !kapali)
    clearInterval(durum.sensorTimer)
    if (!kapali) durum.sensorTimer = setInterval(sensorDurumuYaz, 200)
  })

  $('#kal-yukseklik').addEventListener('input', (e) => {
    ar.kamera.yukseklikM = Number(e.target.value) / 100
    $('#kal-yukseklik-deger').textContent = ar.kamera.yukseklikM.toFixed(2) + ' m'
  })

  $('#kal-fov').addEventListener('input', (e) => {
    ar.kamera.fovDikey = Number(e.target.value) * (Math.PI / 180)
    $('#kal-fov-deger').textContent = e.target.value + '°'
  })

  $('#btn-gercek-ar-kap').addEventListener('click', gercekAraGec)

  $('#ar-bilgi').addEventListener('click', () => $('#bilgi').classList.remove('gizli'))
  $('#bilgi-kapat').addEventListener('click', () => $('#bilgi').classList.add('gizli'))

  $('#uc-boyut-ac').addEventListener('click', () => {
    $('#vitrin').classList.add('gizli')
    $('#uc-boyut').classList.remove('gizli')
  })
  $('#uc-boyut-kapat').addEventListener('click', () => {
    $('#uc-boyut').classList.add('gizli')
    $('#vitrin').classList.remove('gizli')
  })
}

basla()
