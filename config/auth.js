(function(){

    const token =
        sessionStorage.getItem("token");

    if(!token){

        location.href = "/login.html";
    }

})();
