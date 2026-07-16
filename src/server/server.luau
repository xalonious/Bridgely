-- Place this Script in ServerScriptService and enable HTTP Requests for the experience.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local API_BASE_URL = "https://YOUR-DOMAIN.example.com" -- Replace with your API URL
local API_KEY = "12345" -- Replace with your api key

local function request(method: string, path: string, body: any?)
	local options = {
		Url = API_BASE_URL .. path,
		Method = method,
		Headers = {
			["Authorization"] = "Bearer " .. API_KEY,
			["Content-Type"] = "application/json",
		},
	}

	if body ~= nil then
		options.Body = HttpService:JSONEncode(body)
	end

	return HttpService:RequestAsync(options)
end

local function decodeResponse(response)
	if type(response.Body) ~= "string" or response.Body == "" then
		return nil
	end

	local success, result = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	return if success then result else nil
end

local function handlePlayer(player: Player)
	local completeOk, completeResponse = pcall(function()
		return request("POST", "/verification/complete", {
			robloxUserId = player.UserId,
		})
	end)

	if not completeOk then
		player:Kick("Bridgely's verification service could not be reached. Please try again later.")
		return
	end

	local result = decodeResponse(completeResponse)

	if completeResponse.Success and result and result.verified == true then
		player:Kick("Verification complete! You may now return to Discord.")
		return
	end

	if completeResponse.StatusCode == 404 then
		player:Kick("You do not have a pending Bridgely verification. Start verification in Discord first.")
		return
	end

	if completeResponse.StatusCode == 401 then
		player:Kick("Bridgely game authentication is misconfigured. Please contact a server administrator.")
		return
	end

	if not completeResponse.Success then
		player:Kick("Bridgely could not complete your verification. Return to Discord and try again.")
		return
	end

	player:Kick("Bridgely returned an invalid verification response. Please try again later.")
end

Players.PlayerAdded:Connect(function(player)
	task.spawn(handlePlayer, player)
end)
