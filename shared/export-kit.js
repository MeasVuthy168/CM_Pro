// =========================================================
// CMExport — small helpers shared by the jsPDF / xlsx-js-style
// exports (Loan Calculate, Average Turnover).
// =========================================================

(function(){

    // Logged-in user's name for "Prepared by".
    function preparedBy(){

        let user={};

        try{ user=JSON.parse(localStorage.getItem("loggedInUser")||"{}"); }catch(e){}

        return (user.fullname||user.username||"-").toUpperCase();

    }

    // Logged-in user's name as typed (e.g. "System Admin").
    function userName(){

        let user={};

        try{ user=JSON.parse(localStorage.getItem("loggedInUser")||"{}"); }catch(e){}

        return user.fullname||user.username||"-";

    }

    function printedDate(d){

        return (d||new Date()).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});

    }

    // ASCII-only file name part: some browsers/WebViews reject
    // non-Latin download names and fall back to a bare "download".
    function safeFilePart(text,fallback){

        return String(text||"").replace(/[^A-Za-z0-9 _-]+/g,"").trim().replace(/\s+/g,"_").slice(0,40)||fallback||"Export";

    }

    // Renders text with the page's own fonts onto a canvas and returns a
    // PNG data URL + size in pt. jsPDF's built-in fonts can't shape
    // Khmer, so names are drawn as images to stay readable.
    function textToImage(text,{size=13,weight="700",color="#0E1B3C"}={}){

        const scale=3;

        const font=`${weight} ${size*scale}px Krasar, "Noto Sans Khmer", Arial, sans-serif`;

        const canvas=document.createElement("canvas");

        const ctx=canvas.getContext("2d");

        ctx.font=font;

        const w=Math.ceil(ctx.measureText(text).width)+4;

        const h=Math.ceil(size*scale*1.6);

        canvas.width=Math.max(w,1);

        canvas.height=h;

        ctx.font=font;

        ctx.fillStyle=color;

        ctx.textBaseline="middle";

        ctx.fillText(text,2,h/2);

        return { data:canvas.toDataURL("image/png"), w:canvas.width/scale, h:h/scale };

    }

    // Bank logo as a small JPEG data URL. The source PNG is ~1700px
    // wide; embedding it as-is makes a multi-MB PDF.
    async function logo(){

        try{

            const res=await fetch("/CM_Pro/assets/images/acleda-logo-whiteBG.png");

            if(!res.ok) return null;

            const blob=await res.blob();

            const url=URL.createObjectURL(blob);

            const img=await new Promise((resolve,reject)=>{

                const i=new Image();

                i.onload=()=>resolve(i);

                i.onerror=reject;

                i.src=url;

            });

            const w=480, h=Math.round(w*img.naturalHeight/img.naturalWidth);

            const canvas=document.createElement("canvas");

            canvas.width=w;

            canvas.height=h;

            const ctx=canvas.getContext("2d");

            ctx.fillStyle="#FFFFFF";

            ctx.fillRect(0,0,w,h);

            ctx.drawImage(img,0,0,w,h);

            URL.revokeObjectURL(url);

            return { data:canvas.toDataURL("image/jpeg",0.9), ratio:h/w, type:"JPEG" };

        }catch(e){

            return null;

        }

    }

    // "Prepared by … • Printed …" + "Page x of y" on every page.
    // leftText overrides the left-hand footer text when given.
    function pdfFooter(doc,{margin=40,preparedBy:by,printed,showPreparedBy=true,leftText}={}){

        const pageW=doc.internal.pageSize.getWidth();

        const pageH=doc.internal.pageSize.getHeight();

        const pages=doc.internal.getNumberOfPages();

        for(let p=1;p<=pages;p++){

            doc.setPage(p);

            doc.setDrawColor(226,230,237);

            doc.setLineWidth(.6);

            doc.line(margin,pageH-36,pageW-margin,pageH-36);

            doc.setFont("helvetica","normal");

            doc.setFontSize(8.5);

            doc.setTextColor(107,114,128);

            doc.text(leftText ? leftText : showPreparedBy

                ? `Prepared by: ${by||preparedBy()}   •   Printed: ${printed||printedDate()}`

                : `Printed: ${printed||printedDate()}`,margin,pageH-22);

            doc.text(`Page ${p} of ${pages}`,pageW-margin,pageH-22,{align:"right"});

        }

    }

    window.CMExport={ preparedBy, userName, printedDate, safeFilePart, textToImage, logo, pdfFooter };

})();
