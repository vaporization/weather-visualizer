const contact=document.getElementById('contact'),esriKey=document.getElementById('esri'),status=document.getElementById('status');
window.settings.read().then(s=>{contact.value=s.flightContact;esriKey.value=s.esriKey;});
document.getElementById('save').onclick=async()=>{try{status.textContent='Saving…';await window.settings.save({flightContact:contact.value,esriKey:esriKey.value});status.textContent='Saved.';}catch(e){status.textContent=e.message;}};
