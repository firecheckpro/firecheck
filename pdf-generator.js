// pdf-generator.js - Génération et sauvegarde de PDF sur iPhone
class PDFManager {
  constructor() {
    this.inspections = JSON.parse(localStorage.getItem('inspections') || '[]');
  }

  // Générer un PDF simple
  async generatePDF(inspectionData) {
    const inspectionId = Date.now();
    
    // 1. Créer le HTML du PDF
    const pdfHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Rapport ${inspectionData.title}</title>
          <style>
            body { font-family: -apple-system, sans-serif; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .title { color: #FF6B35; font-size: 24px; }
            .section { margin: 20px 0; border-top: 2px solid #333; padding-top: 10px; }
            .item { margin: 10px 0; }
            .status-ok { color: green; }
            .status-ko { color: red; }
            .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">🔥 FireCheck Pro</h1>
            <h2>${inspectionData.title}</h2>
            <p>Date: ${new Date().toLocaleDateString('fr-FR')}</p>
          </div>
          
          ${inspectionData.sections.map(section => `
            <div class="section">
              <h3>${section.title}</h3>
              ${section.items.map(item => `
                <div class="item">
                  <strong>${item.question}</strong>: 
                  <span class="status-${item.status}">${item.status === 'ok' ? '✅ Conforme' : '❌ Non conforme'}</span>
                  ${item.comment ? `<p><em>${item.comment}</em></p>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
          
          <div class="footer">
            <p>Rapport généré localement depuis l'application FireCheck Pro</p>
            <p>ID: ${inspectionId}</p>
          </div>
        </body>
      </html>
    `;

    // 2. Générer le PDF (méthode simplifiée pour iPhone)
    const pdfBlob = await this.htmlToPDF(pdfHTML);
    
    // 3. Sauvegarder localement
    await this.savePDFLocally(pdfBlob, `firecheck_${inspectionId}.pdf`);
    
    // 4. Sauvegarder les données pour historique
    this.saveInspectionData(inspectionData, inspectionId, pdfBlob);
    
    return { success: true, id: inspectionId, filename: `firecheck_${inspectionId}.pdf` };
  }

  // Convertir HTML en PDF (méthode simplifiée)
  async htmlToPDF(html) {
    // Pour iPhone, on génère un PDF simple
    // Note: Pour une meilleure qualité, utilisez une librairie comme jsPDF
    const text = html.replace(/<[^>]*>/g, ''); // Version texte simple
    const blob = new Blob([text], { type: 'application/pdf' });
    
    // Alternative: générer un HTML sauvegardable
    const htmlBlob = new Blob([html], { type: 'text/html' });
    
    return htmlBlob; // On retourne du HTML pour iPhone
  }

  // Sauvegarder le PDF localement (iPhone compatible)
  async savePDFLocally(blob, filename) {
    if ('showSaveFilePicker' in window) {
      // Chrome/Edge
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'PDF Files',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (err) {
        console.log('Annulation de l\'enregistrement');
      }
    } else if (window.webkit && window.webkit.messageHandlers) {
      // iOS WebView (si intégré dans une app native)
      window.webkit.messageHandlers.savePDF.postMessage({
        filename: filename,
        data: await blob.text()
      });
    } else {
      // Fallback pour Safari iPhone
      return this.saveOniPhone(blob, filename);
    }
  }

  // Méthode spécifique iPhone/Safari
  saveOniPhone(blob, filename) {
    // Méthode 1: Téléchargement via lien
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Méthode 2: Ouvrir dans nouvel onglet (pour visualisation)
    window.open(url, '_blank');
    
    return true;
  }

  // Sauvegarder les données d'inspection
  saveInspectionData(data, id, pdfBlob) {
    const inspection = {
      id: id,
      date: new Date().toISOString(),
      data: data,
      pdfUrl: URL.createObjectURL(pdfBlob),
      local: true
    };
    
    this.inspections.push(inspection);
    localStorage.setItem('inspections', JSON.stringify(this.inspections));
    
    // Mettre à jour l'interface
    this.updateInspectionList();
  }

  // Afficher la liste des inspections
  updateInspectionList() {
    const listElement = document.getElementById('inspections-list');
    if (!listElement) return;
    
    listElement.innerHTML = this.inspections.map(insp => `
      <div class="inspection-item">
        <h3>${insp.data.title}</h3>
        <p>${new Date(insp.date).toLocaleDateString('fr-FR')}</p>
        <button onclick="pdfManager.openPDF('${insp.id}')">📄 Ouvrir PDF</button>
        <button onclick="pdfManager.sharePDF('${insp.id}')">📱 Partager</button>
      </div>
    `).join('');
  }

  // Ouvrir un PDF existant
  openPDF(id) {
    const inspection = this.inspections.find(i => i.id === parseInt(id));
    if (inspection && inspection.pdfUrl) {
      window.open(inspection.pdfUrl, '_blank');
    }
  }

  // Partager un PDF (iPhone compatible)
  async sharePDF(id) {
    const inspection = this.inspections.find(i => i.id === parseInt(id));
    if (!inspection) return;
    
    // Créer un nouveau blob à partir des données
    const response = await fetch(inspection.pdfUrl);
    const blob = await response.blob();
    
    if (navigator.share) {
      // API Web Share (iPhone compatible)
      const file = new File([blob], `firecheck_${id}.pdf`, { type: 'application/pdf' });
      
      try {
        await navigator.share({
          title: `Rapport ${inspection.data.title}`,
          text: 'Rapport FireCheck Pro',
          files: [file]
        });
      } catch (err) {
        console.log('Partage annulé');
      }
    } else {
      // Fallback
      this.saveOniPhone(blob, `firecheck_${id}.pdf`);
    }
  }
}

// Initialisation
window.pdfManager = new PDFManager();
